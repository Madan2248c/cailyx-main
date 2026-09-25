/**
 * The per-page SEO scoring rubric — pure, deterministic, no I/O.
 *
 * Ported verbatim from the old repo's `checks/seo-rubric.ts`: every band and
 * deduction weight in `technical-audit.constants.ts` (`SEO_BANDS`,
 * `SEO_DEDUCTIONS`) is a tuned number from that shipped code, several with
 * their own sourcing (the file's own comments cite Backlinko/Moz for the URL
 * length band). Rule branching order is load-bearing — the issues array's
 * order is relied on for run-to-run comparability — and is preserved exactly.
 *
 * Network/model calls belong in the check that calls this, never in here.
 *
 * @module technical-audit/services/checks/seo-rubric
 */

import { SEO_BANDS, SEO_DEDUCTIONS, WORST_PAGES_LIMIT } from '../../technical-audit.constants.js';
import type { AuditPageResult, PageIssueCode, PageInventoryAnalysis } from '../../technical-audit.types.js';

/** The raw per-page signals `page-signals.ts` extracts — everything the rubric needs to judge one page. */
export interface PageSignals {
  status: number;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  noindex: boolean;
  /** Document-order heading levels, e.g. `[1, 2, 2, 3]`. */
  headingLevels: number[];
  h1Count: number;
  wordCount: number;
  imageCount: number;
  imagesMissingAlt: number;
  jsonLdCount: number;
  jsonLdValid: boolean;
  jsonLdTypes: string[];
  contentHash: string | null;
}

/**
 * Every issue this page trips, in rubric order.
 *
 * `status === 0 || status >= 400` short-circuits to `['page-error']` alone —
 * nothing else is evaluated. Every other rule still runs even when an
 * earlier one fired (`noindex` does NOT short-circuit, unlike `page-error`).
 */
export function findPageIssues(signals: PageSignals, pageUrl: string, siteHost: string): PageIssueCode[] {
  if (signals.status === 0 || signals.status >= 400) return ['page-error'];

  const issues: PageIssueCode[] = [];

  if (signals.noindex) issues.push('noindex');

  // Title — missing / too-short / too-long, mutually exclusive.
  const title = signals.title?.trim() ?? '';
  if (!title) issues.push('title-missing');
  else if (title.length < SEO_BANDS.titleMin) issues.push('title-too-short');
  else if (title.length > SEO_BANDS.titleMax) issues.push('title-too-long');

  // Meta description — same pattern.
  const meta = signals.metaDescription?.trim() ?? '';
  if (!meta) issues.push('meta-missing');
  else if (meta.length < SEO_BANDS.metaMin) issues.push('meta-too-short');
  else if (meta.length > SEO_BANDS.metaMax) issues.push('meta-too-long');

  // H1.
  if (signals.h1Count === 0) issues.push('h1-missing');
  else if (signals.h1Count > 1) issues.push('h1-multiple');

  // Heading hierarchy — one flag total, not per skip.
  if (findHeadingIssue(signals.headingLevels)) issues.push('heading-level-skipped');

  // Canonical.
  const canonicalIssue = findCanonicalIssue(signals.canonical, pageUrl, siteHost);
  if (canonicalIssue) issues.push(canonicalIssue);

  // URL structure — not mutually exclusive, can stack.
  issues.push(...findUrlIssues(pageUrl));

  // JSON-LD.
  if (signals.jsonLdCount === 0) issues.push('json-ld-missing');
  else if (!signals.jsonLdValid) issues.push('json-ld-invalid');

  // Word count.
  if (signals.wordCount < SEO_BANDS.minWords) issues.push('thin-content');

  // Alt coverage — only evaluated when the page has images with any missing alt.
  if (signals.imageCount > 0 && signals.imagesMissingAlt > 0) {
    const ratio = signals.imagesMissingAlt / signals.imageCount;
    if (ratio > SEO_BANDS.maxMissingAltRatio || signals.imagesMissingAlt === signals.imageCount) {
      issues.push('images-missing-alt');
    }
  }

  return issues;
}

/**
 * A level jump past the deepest level introduced so far (e.g. an H1 followed
 * directly by an H3, skipping H2) — WCAG 2.4.6 territory. Returns true on the
 * first skip found; the page is flagged once, not once per skip.
 */
function findHeadingIssue(levels: number[]): boolean {
  let deepestIntroduced = 0;
  for (const level of levels) {
    if (level > deepestIntroduced + 1) return true;
    if (level > deepestIntroduced) deepestIntroduced = level;
  }
  return false;
}

/**
 * Missing/blank → `canonical-missing`; unparseable or non-http(s) →
 * `canonical-malformed`; hostname (www.-stripped, case-insensitive) differs
 * from the site's → `canonical-cross-domain`. Same-domain-different-path is
 * explicitly NOT flagged — pagination and faceted nav are legitimate uses of
 * a canonical that points elsewhere on the same site.
 */
function findCanonicalIssue(canonical: string | null, pageUrl: string, siteHost: string): PageIssueCode | null {
  const value = canonical?.trim();
  if (!value) return 'canonical-missing';

  let resolved: URL;
  try {
    resolved = new URL(value, pageUrl);
  } catch {
    return 'canonical-malformed';
  }
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return 'canonical-malformed';

  const canonicalHost = resolved.hostname.replace(/^www\./i, '').toLowerCase();
  const ownHost = siteHost.replace(/^www\./i, '').toLowerCase();
  if (canonicalHost !== ownHost) return 'canonical-cross-domain';

  return null;
}

/**
 * Not mutually exclusive — length, casing, underscores and excess params are
 * each checked independently and can stack on one URL. An unparseable URL
 * returns no issues here (that's `page-error` territory, handled earlier).
 */
function findUrlIssues(pageUrl: string): PageIssueCode[] {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return [];
  }
  const issues: PageIssueCode[] = [];
  if (pageUrl.length > SEO_BANDS.urlMaxLength) issues.push('url-too-long');
  if (/[A-Z]/.test(url.pathname)) issues.push('url-has-uppercase');
  if (url.pathname.includes('_')) issues.push('url-has-underscore');
  if ([...url.searchParams.keys()].length > SEO_BANDS.urlMaxParams) issues.push('url-excess-params');
  return issues;
}

/** `100 − Σ deductions`, clamped to ≥ 0. Overlapping issues are additive, not capped per-issue. */
export function scorePage(issues: PageIssueCode[]): number {
  const total = issues.reduce((sum, issue) => sum + (SEO_DEDUCTIONS[issue] ?? 0), 0);
  return Math.max(0, 100 - total);
}

/**
 * Cross-page duplicate-content detection: exact `contentHash` match only, no
 * similarity threshold. Every URL in any group of size > 1 is flagged. Pages
 * with a null hash (errored or empty) are skipped entirely, never grouped —
 * two error pages are not "duplicates of each other."
 *
 * @returns the set of URLs that share a hash with at least one other page.
 */
export function findDuplicateContent(pages: Array<{ url: string; contentHash: string | null }>): Set<string> {
  const byHash = new Map<string, string[]>();
  for (const page of pages) {
    if (!page.contentHash) continue;
    const group = byHash.get(page.contentHash) ?? [];
    group.push(page.url);
    byHash.set(page.contentHash, group);
  }
  const duplicates = new Set<string>();
  for (const group of byHash.values()) {
    if (group.length > 1) for (const url of group) duplicates.add(url);
  }
  return duplicates;
}

/**
 * Run-level rollup. `averageScore` excludes `page-error` pages (a dead page
 * isn't "content quality 0", it's not content at all). URL-issue counts are
 * counted as distinct pages, not summed, since those codes are not mutually
 * exclusive per page. Image totals are summed across every crawled page
 * regardless of flag status, not just flagged ones.
 */
export function summarisePages(pages: AuditPageResult[], discovered: number, budget: number): PageInventoryAnalysis {
  const ok = pages.filter((p) => !p.issues.includes('page-error'));
  const errored = pages.length - ok.length;

  const averageScore = ok.length > 0 ? Math.round(ok.reduce((sum, p) => sum + p.score, 0) / ok.length) : null;

  const issueCounts: Record<string, number> = {};
  for (const page of pages) {
    for (const issue of page.issues) issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
  }

  const worstPages = [...ok]
    .sort((a, b) => a.score - b.score || a.url.localeCompare(b.url))
    .slice(0, WORST_PAGES_LIMIT)
    .map((p) => ({ url: p.url, score: p.score, issues: p.issues }));

  const hasAny = (codes: PageIssueCode[]) => (p: AuditPageResult) => codes.some((c) => p.issues.includes(c));

  return {
    discovered,
    crawled: pages.length,
    budget,
    ok: ok.length,
    errored,
    averageScore,
    issueCounts,
    worstPages,
    pagesWithoutJsonLd: pages.filter(hasAny(['json-ld-missing'])).length,
    pagesWithBadTitle: pages.filter(hasAny(['title-missing', 'title-too-short', 'title-too-long'])).length,
    pagesWithBadMeta: pages.filter(hasAny(['meta-missing', 'meta-too-short', 'meta-too-long'])).length,
    pagesThin: pages.filter(hasAny(['thin-content'])).length,
    pagesWithMissingAlt: pages.filter(hasAny(['images-missing-alt'])).length,
    pagesWithDuplicateContent: pages.filter(hasAny(['duplicate-content'])).length,
    imagesTotal: pages.reduce((sum, p) => sum + (p.imageCount ?? 0), 0),
    imagesMissingAlt: pages.reduce((sum, p) => sum + (p.imagesMissingAlt ?? 0), 0),
    pagesWithHeadingIssues: pages.filter(hasAny(['heading-level-skipped'])).length,
    pagesWithBadCanonical: pages.filter(hasAny(['canonical-missing', 'canonical-malformed', 'canonical-cross-domain'])).length,
    pagesWithUrlIssues: pages.filter(hasAny(['url-too-long', 'url-has-uppercase', 'url-has-underscore', 'url-excess-params'])).length,
  };
}
