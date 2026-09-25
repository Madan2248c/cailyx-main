/**
 * Sitemap check — is there a sitemap, does it cover the site, and is it
 * actually kept up to date?
 *
 * Built on the shared `discoverSitemapTree` (`fetcher/sitemap-tree.ts`),
 * which this module's own design fixed to read every robots.txt-declared
 * `Sitemap:` entry point rather than stopping at the first that resolves —
 * see docs/analysis/technical-audit.md "Sitemap check". Unlike the old
 * repo's single-`sitemapUrl` shape, `SitemapAnalysis` here carries both
 * `sitemapUrl` (first resolved entry point, for simple display) and
 * `sitemapUrls` (every one that resolved), because this module genuinely
 * reads more than one when a site declares more than one.
 *
 * Presence alone is close to worthless — a sitemap committed once and never
 * touched again asserts a freshness it doesn't have — so `staleDays` is
 * treated as seriously as `found`.
 *
 * @module technical-audit/services/checks/sitemap
 */

import { Injectable } from '@nestjs/common';
import { discoverSitemapTree, type SitemapCrawlBudget } from '../../../fetcher/sitemap-tree.js';
import { FetcherService } from '../../../fetcher/fetcher.service.js';
import { MAX_CHILD_SITEMAPS, MAX_SITEMAP_ENTRIES, SITEMAP_FALLBACK_PATHS } from '../../technical-audit.constants.js';
import type { AuditContext } from '../audit-context.js';
import type { AuditFinding, SitemapAnalysis, SitemapEntry } from '../../technical-audit.types.js';

const SITEMAP_MAX_DEPTH = 4;
/** A sitemap not updated in this many days reads as stale, not just "old." */
const SITEMAP_STALE_DAYS = 90;

/**
 * Technical Audit has no per-job elapsed-time budget the way Discovery does
 * (see docs/analysis/technical-audit.md "Job orchestration") — one BullMQ job
 * runs a bounded set of HTTP calls to completion, not an open-ended crawl. So
 * this check hands `discoverSitemapTree` an effectively unbounded request
 * counter rather than Discovery's per-run `RunBudget`; the real bound on
 * sitemap-tree work is `MAX_CHILD_SITEMAPS`/`SITEMAP_MAX_DEPTH`, same as it
 * was for the old code's own (single-entry-point) sitemap check.
 */
function unboundedBudget(): SitemapCrawlBudget {
  return { requestsLeft: () => Infinity, spendRequests: () => {} };
}

@Injectable()
export class SitemapCheck {
  constructor(private readonly fetcher: FetcherService) {}

  async run(ctx: AuditContext): Promise<AuditFinding & { entries: SitemapEntry[] }> {
    const origin = new URL(ctx.targetUrl).origin;

    const tree = await discoverSitemapTree(this.fetcher, origin, unboundedBudget(), ctx.runId, {
      maxDepth: SITEMAP_MAX_DEPTH,
      maxFiles: MAX_CHILD_SITEMAPS,
      fallbackPaths: SITEMAP_FALLBACK_PATHS,
      calledBy: 'technical-audit',
    });

    const entries = tree.entries.slice(0, MAX_SITEMAP_ENTRIES);
    const resolved = tree.entryPoints.filter((e) => e.resolved);
    const found = resolved.length > 0;

    const stamps = entries.map((e) => e.lastmod).filter((d): d is string => !!d).sort();
    const newestLastmod = stamps.length > 0 ? stamps[stamps.length - 1]! : null;
    const oldestLastmod = stamps.length > 0 ? stamps[0]! : null;
    const staleDays = newestLastmod ? Math.floor((Date.now() - new Date(newestLastmod).getTime()) / 86_400_000) : null;

    const seen = new Set<string>();
    let duplicateCount = 0;
    let offOriginCount = 0;
    for (const entry of entries) {
      if (seen.has(entry.url)) duplicateCount++;
      seen.add(entry.url);
      try {
        if (new URL(entry.url).origin !== origin) offOriginCount++;
      } catch {
        offOriginCount++;
      }
    }

    const analysis: SitemapAnalysis = {
      found,
      sitemapUrl: resolved[0]?.url ?? null,
      sitemapUrls: resolved.map((e) => e.url),
      triedUrls: tree.entryPoints.map((e) => e.url),
      statusCode: resolved[0]?.statusCode ?? 0,
      isIndex: resolved.some((e) => e.isIndex),
      // `discoverSitemapTree` returns only the flattened page entries, not the
      // intermediate child-sitemap URLs it read while walking an index — that
      // list isn't part of its return shape (see the module's own doc), so
      // this is honestly empty rather than a guess. Extending the shared
      // module to also report them is a reasonable follow-up if the report UI
      // ends up wanting to show the child-sitemap tree itself.
      childSitemaps: [],
      urlCount: entries.length,
      withLastmod: stamps.length,
      newestLastmod,
      oldestLastmod,
      staleDays,
      declaredInRobots: tree.declaredInRobots,
      duplicateCount,
      offOriginCount,
      entries,
    };

    const { status, severity, recommendedFix } = this.verdict(analysis);

    return {
      type: 'sitemap',
      status,
      severity,
      confidence: 'confirmed',
      recommendedFix,
      detail: { ...analysis },
      entries,
    };
  }

  private verdict(analysis: SitemapAnalysis): Pick<AuditFinding, 'status' | 'severity' | 'recommendedFix'> {
    if (!analysis.found) {
      return {
        status: 'fail',
        severity: 'medium',
        recommendedFix:
          'No sitemap found at any conventional location or robots.txt-declared entry point. Publish a sitemap.xml and declare it in robots.txt so crawlers and AI agents can discover every page.',
      };
    }
    if (analysis.staleDays !== null && analysis.staleDays > SITEMAP_STALE_DAYS) {
      return {
        status: 'fail',
        severity: 'low',
        recommendedFix: `The sitemap's newest <lastmod> is ${analysis.staleDays} days old (over the ${SITEMAP_STALE_DAYS}-day freshness bar) across ${analysis.urlCount} URLs. A sitemap that never updates tells crawlers the site is stale even when it isn't — regenerate it on publish, not once at launch.`,
      };
    }
    return {
      status: 'pass',
      severity: 'low',
      recommendedFix: `Sitemap found with ${analysis.urlCount} URLs${analysis.staleDays !== null ? `, most recently updated ${analysis.staleDays} day(s) ago` : ' (no <lastmod> declared)'}. Coverage and freshness look healthy.`,
    };
  }
}
