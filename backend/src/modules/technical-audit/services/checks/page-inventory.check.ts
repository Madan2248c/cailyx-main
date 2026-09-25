/**
 * Page inventory check — crawl the sitemap's URLs and score each one against
 * the SEO rubric.
 *
 * Ported from the old repo's `checks/page-inventory.check.ts`: newest-first
 * prioritisation, the robots.txt filter, batched concurrency, and the
 * two-pass duplicate-content re-score are all preserved exactly.
 *
 * **Discovery-page reuse, scoped down from "skip the fetch."** Discovery
 * persists no raw HTML (docs/analysis/discovery.md "What we persist per
 * page"), so canonical URL, per-image alt data, and heading *levels* don't
 * exist anywhere in `discovered_pages` — this check always does its own
 * fetch regardless of whether Discovery already visited a URL, because those
 * signals genuinely aren't available any other way. A `discovered_pages` row
 * is consulted only as a fallback source for `title`/`metaDescription` when
 * this check's own fetch fails outright (a page-error page still gets a
 * plausible title/description if Discovery has one, rather than nulls) —
 * see docs/analysis/technical-audit.md "Reusing Discovery's fetched pages"
 * for why a bigger reuse isn't possible without Discovery storing more.
 *
 * @module technical-audit/services/checks/page-inventory
 */

import { Injectable } from '@nestjs/common';
import { FetcherService } from '../../../fetcher/fetcher.service.js';
import { RobotsService } from '../../../fetcher/services/robots.service.js';
import { PrismaService } from '../../../../prisma/prisma.service.js';
import { DEFAULT_PAGE_CRAWL_BUDGET, DEFAULT_PAGE_CRAWL_CONCURRENCY } from '../../technical-audit.constants.js';
import type { AuditContext } from '../audit-context.js';
import type { AuditFinding, AuditPageResult, SitemapEntry } from '../../technical-audit.types.js';
import { extractPageSignals } from './page-signals.js';
import { findDuplicateContent, findPageIssues, scorePage, summarisePages, type PageSignals } from './seo-rubric.js';

/** Below this average score the check itself is a 'fail', not just individual pages. */
const AVERAGE_SCORE_FAIL_THRESHOLD = 70;
/** Below this average score severity escalates to 'high' rather than 'medium'. */
const AVERAGE_SCORE_HIGH_SEVERITY_THRESHOLD = 40;

@Injectable()
export class PageInventoryCheck {
  constructor(
    private readonly fetcher: FetcherService,
    private readonly robots: RobotsService,
  ) {}

  async run(ctx: AuditContext, entries: SitemapEntry[], prisma: PrismaService): Promise<AuditFinding & { pages: AuditPageResult[] }> {
    if (entries.length === 0) {
      return {
        type: 'page-inventory',
        status: 'not-run',
        severity: 'low',
        confidence: 'confirmed',
        recommendedFix: 'No sitemap entries to crawl — see the sitemap check for why.',
        detail: {},
        pages: [],
      };
    }

    const ordered = this.dedupeAndPrioritise(entries);
    const budget = DEFAULT_PAGE_CRAWL_BUDGET;
    const candidates = ordered.slice(0, budget);
    const allowedUrls = new Set(await this.robots.filterAllowed(candidates.map((e) => e.url)));
    const selected = candidates.filter((e) => allowedUrls.has(e.url));

    const siteHost = new URL(ctx.targetUrl).host;
    // contentHash lives alongside each page only for the duplicate-content
    // pass below — it is not part of `AuditPageResult` itself.
    const pages: AuditPageResult[] = [];
    const hashes = new Map<string, string | null>();

    for (let i = 0; i < selected.length; i += DEFAULT_PAGE_CRAWL_CONCURRENCY) {
      const batch = selected.slice(i, i + DEFAULT_PAGE_CRAWL_CONCURRENCY);
      const results = await Promise.all(batch.map((entry) => this.scoreOne(ctx, entry, siteHost, prisma)));
      for (const { page, contentHash } of results) {
        pages.push(page);
        hashes.set(page.url, contentHash);
      }
    }

    // Two-pass duplicate-content: only after every page has its own score
    // does a shared-hash group get flagged and re-scored — the deduction
    // must land on the second pass, not the first.
    const duplicates = findDuplicateContent(pages.map((p) => ({ url: p.url, contentHash: hashes.get(p.url) ?? null })));
    for (const page of pages) {
      if (duplicates.has(page.url) && !page.issues.includes('page-error')) {
        page.issues.push('duplicate-content');
        page.score = scorePage(page.issues);
      }
    }

    const analysis = summarisePages(pages, entries.length, budget);
    const { status, severity } = this.verdict(analysis.averageScore);

    return {
      type: 'page-inventory',
      status,
      severity,
      confidence: 'confirmed',
      recommendedFix: this.recommendedFix(analysis),
      detail: { ...analysis },
      pages,
    };
  }

  /** Dedupe by URL, newest-`lastmod`-first; entries with no `lastmod` sort last, in original relative order. */
  private dedupeAndPrioritise(entries: SitemapEntry[]): SitemapEntry[] {
    const seen = new Map<string, SitemapEntry>();
    for (const entry of entries) if (!seen.has(entry.url)) seen.set(entry.url, entry);
    return [...seen.values()].sort((a, b) => {
      if (a.lastmod && b.lastmod) return b.lastmod.localeCompare(a.lastmod);
      if (a.lastmod) return -1;
      if (b.lastmod) return 1;
      return 0;
    });
  }

  private async scoreOne(
    ctx: AuditContext,
    entry: SitemapEntry,
    siteHost: string,
    prisma: PrismaService,
  ): Promise<{ page: AuditPageResult; contentHash: string | null }> {
    let fetchStatus = 0;
    let html = '';
    try {
      const res = await this.fetcher.fetch({ url: entry.url, cacheTtlSeconds: 3600 }, 'technical-audit', ctx.runId);
      fetchStatus = res.status;
      html = res.body ?? '';
    } catch {
      fetchStatus = 0;
    }

    if (fetchStatus === 0 || fetchStatus >= 400 || !html) {
      // A dead/unreachable page still gets a plausible title if Discovery
      // already has one on file — this is the one place reuse helps, since
      // everything else about a page-error page is moot (findPageIssues
      // short-circuits to just `page-error` regardless of these fields).
      const reused = await this.reusedTitle(ctx, entry.url, prisma);
      const stub: PageSignals = {
        status: fetchStatus,
        title: reused?.title ?? null,
        metaDescription: reused?.metaDescription ?? null,
        canonical: null,
        noindex: false,
        headingLevels: [],
        h1Count: 0,
        wordCount: 0,
        imageCount: 0,
        imagesMissingAlt: 0,
        jsonLdCount: 0,
        jsonLdValid: false,
        jsonLdTypes: [],
        contentHash: null,
      };
      const issues = findPageIssues(stub, entry.url, siteHost);
      return {
        page: this.toResult(entry, stub, issues),
        contentHash: null,
      };
    }

    const signals = extractPageSignals(html, fetchStatus, entry.url, siteHost);
    const issues = findPageIssues(signals, entry.url, siteHost);
    return { page: this.toResult(entry, signals, issues), contentHash: signals.contentHash };
  }

  private toResult(entry: SitemapEntry, signals: PageSignals, issues: AuditPageResult['issues']): AuditPageResult {
    const jsonLdTypes = 'jsonLdTypes' in signals ? (signals as { jsonLdTypes: string[] }).jsonLdTypes : [];
    return {
      url: entry.url,
      status: signals.status,
      lastmod: entry.lastmod,
      title: signals.title,
      titleLength: signals.title?.length ?? null,
      metaDescription: signals.metaDescription,
      metaDescLength: signals.metaDescription?.length ?? null,
      h1Count: signals.h1Count,
      canonical: signals.canonical,
      wordCount: signals.wordCount,
      imageCount: signals.imageCount,
      imagesMissingAlt: signals.imagesMissingAlt,
      jsonLdTypes,
      jsonLdValid: signals.jsonLdValid,
      jsonLdCount: signals.jsonLdCount,
      issues,
      score: scorePage(issues),
    };
  }

  private async reusedTitle(
    ctx: AuditContext,
    url: string,
    prisma: PrismaService,
  ): Promise<{ title: string | null; metaDescription: string | null } | null> {
    try {
      const row = await prisma.discoveredPage.findFirst({ where: { projectId: ctx.project.id, url } });
      if (!row) return null;
      const state = (row.pipelineState ?? {}) as { title?: string | null; description?: string | null };
      return { title: state.title ?? null, metaDescription: state.description ?? null };
    } catch {
      return null; // reuse is a nice-to-have, never a reason to fail the crawl
    }
  }

  private verdict(averageScore: number | null): Pick<AuditFinding, 'status' | 'severity'> {
    if (averageScore === null || averageScore >= AVERAGE_SCORE_FAIL_THRESHOLD) {
      return { status: 'pass', severity: 'low' };
    }
    return { status: 'fail', severity: averageScore < AVERAGE_SCORE_HIGH_SEVERITY_THRESHOLD ? 'high' : 'medium' };
  }

  private recommendedFix(analysis: ReturnType<typeof summarisePages>): string {
    if (analysis.crawled === 0) return 'No pages could be crawled from the sitemap.';
    const parts: string[] = [];
    if (analysis.pagesWithBadMeta > 0) parts.push(`${analysis.pagesWithBadMeta} page(s) with a meta-description problem`);
    if (analysis.pagesWithBadTitle > 0) parts.push(`${analysis.pagesWithBadTitle} page(s) with a title problem`);
    if (analysis.pagesThin > 0) parts.push(`${analysis.pagesThin} thin-content page(s)`);
    if (analysis.pagesWithoutJsonLd > 0) parts.push(`${analysis.pagesWithoutJsonLd} page(s) with no structured data`);
    if (analysis.pagesWithDuplicateContent > 0) parts.push(`${analysis.pagesWithDuplicateContent} page(s) duplicating another page's content`);
    if (parts.length === 0) {
      return `Crawled ${analysis.crawled} page(s), average score ${analysis.averageScore ?? 'n/a'}. No widespread issues found.`;
    }
    return `Crawled ${analysis.crawled} page(s), average score ${analysis.averageScore ?? 'n/a'}: ${parts.slice(0, 3).join(', ')}.`;
  }
}
