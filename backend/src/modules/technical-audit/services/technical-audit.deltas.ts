/**
 * Run-over-run comparison — pure functions, no I/O, no framework.
 *
 * Reduces a run to a flat named-metric bag (`ComparableRun`), diffs two runs'
 * metrics, and separately diffs their page sets by URL. Deliberately framework-
 * and Prisma-free so the diff logic is testable without a database and
 * reusable anywhere a run needs comparing.
 *
 * @module technical-audit/services/technical-audit.deltas
 */

import type { AuditComparison, AuditDelta, DeltaDirection } from '../technical-audit.types.js';

/** The minimal shape a run needs to be diffed — a projection of a persisted `technical_audit_runs` row + its `audit_pages`. */
export interface ComparableRun {
  id: string;
  createdAt: string;
  score: number | null;
  findings: Array<{ type: string; status: string; severity: string; detail: unknown }>;
  pages: Array<{ url: string; score: number; issues: string[] }>;
}

interface MetricDef {
  key: string;
  label: string;
  /** True when a higher number is better — the UI needs it to colour the arrow. */
  higherIsBetter: boolean;
  /** How to read this metric off one run. Defensive by construction — a missing/mismatched finding shape yields `null`, never throws. */
  read: (run: ComparableRun) => number | null;
}

function findingDetail(run: ComparableRun, type: string): Record<string, unknown> | undefined {
  const finding = run.findings.find((f) => f.type === type);
  return finding?.detail as Record<string, unknown> | undefined;
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function countPagesWithAnyIssue(run: ComparableRun, codes: string[]): number {
  return run.pages.filter((p) => codes.some((c) => p.issues.includes(c))).length;
}

/**
 * The 16-metric registry. Order here is display order — a caller rendering
 * `computeDeltas`'s output in registry order gets a stable, meaningful
 * layout without re-sorting.
 */
export const METRICS: MetricDef[] = [
  { key: 'composite', label: 'Overall audit score', higherIsBetter: true, read: (r) => numeric(r.score) },
  {
    key: 'openFailures',
    label: 'Failing checks',
    higherIsBetter: false,
    read: (r) => r.findings.filter((f) => f.status === 'fail').length,
  },
  {
    key: 'agentReadiness',
    label: 'Agent readiness (is-agentic)',
    higherIsBetter: true,
    read: (r) => numeric(findingDetail(r, 'agent-readiness')?.score),
  },
  {
    key: 'lighthousePerformance',
    label: 'Lighthouse performance',
    higherIsBetter: true,
    read: (r) => numeric((findingDetail(r, 'cwv')?.categories as Record<string, unknown> | undefined)?.performance),
  },
  {
    key: 'lighthouseSeo',
    label: 'Lighthouse SEO',
    higherIsBetter: true,
    read: (r) => numeric((findingDetail(r, 'cwv')?.categories as Record<string, unknown> | undefined)?.seo),
  },
  {
    key: 'lighthouseAccessibility',
    label: 'Lighthouse accessibility',
    higherIsBetter: true,
    read: (r) => numeric((findingDetail(r, 'cwv')?.categories as Record<string, unknown> | undefined)?.accessibility),
  },
  { key: 'lcp', label: 'LCP (ms)', higherIsBetter: false, read: (r) => numeric(findingDetail(r, 'cwv')?.lcp) },
  { key: 'cls', label: 'CLS', higherIsBetter: false, read: (r) => numeric(findingDetail(r, 'cwv')?.cls) },
  { key: 'inp', label: 'INP (ms)', higherIsBetter: false, read: (r) => numeric(findingDetail(r, 'cwv')?.inp) },
  {
    key: 'sitemapUrls',
    label: 'URLs in sitemap',
    higherIsBetter: true,
    read: (r) => numeric(findingDetail(r, 'sitemap')?.urlCount),
  },
  {
    key: 'sitemapStaleDays',
    label: 'Days since sitemap last changed',
    higherIsBetter: false,
    read: (r) => numeric(findingDetail(r, 'sitemap')?.staleDays),
  },
  {
    key: 'pageAverageScore',
    label: 'Average page score',
    higherIsBetter: true,
    read: (r) => numeric(findingDetail(r, 'page-inventory')?.averageScore),
  },
  {
    key: 'pagesWithoutJsonLd',
    label: 'Pages with no JSON-LD',
    higherIsBetter: false,
    read: (r) => countPagesWithAnyIssue(r, ['json-ld-missing']),
  },
  {
    key: 'pagesBadTitle',
    label: 'Pages with a title problem',
    higherIsBetter: false,
    read: (r) => countPagesWithAnyIssue(r, ['title-missing', 'title-too-long', 'title-too-short']),
  },
  {
    key: 'pagesBadMeta',
    label: 'Pages with a meta-description problem',
    higherIsBetter: false,
    read: (r) => countPagesWithAnyIssue(r, ['meta-missing', 'meta-too-long', 'meta-too-short']),
  },
  {
    key: 'blockedBots',
    label: 'AI crawlers blocked at the CDN',
    higherIsBetter: false,
    read: (r) => numeric((findingDetail(r, 'cdn-inferred')?.blockedBots as unknown[] | undefined)?.length),
  },
];

function round(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

/**
 * `cur === null` → `unchanged` (nothing was newly measured, so there is
 * nothing to call an improvement or a regression). `prev === null` (but
 * `cur` is not) → `new`. Equal → `unchanged`. Otherwise `improved` iff the
 * direction of the rise matches the metric's own `higherIsBetter` — a metric
 * where lower is better (LCP, CLS, staleDays, failure counts) must not be
 * painted green just because the raw number went up.
 */
function direction(prev: number | null, cur: number | null, higherIsBetter: boolean): DeltaDirection {
  if (cur === null) return 'unchanged';
  if (prev === null) return 'new';
  if (cur === prev) return 'unchanged';
  const rose = cur > prev;
  return rose === higherIsBetter ? 'improved' : 'regressed';
}

/**
 * One delta per metric that has a value in the current run, the previous
 * run, or both. A metric absent from both (e.g. CWV when PSI never ran, on
 * either run) is dropped entirely rather than reported as an empty row.
 */
export function computeDeltas(current: ComparableRun, previous: ComparableRun | null): AuditDelta[] {
  const out: AuditDelta[] = [];
  for (const metric of METRICS) {
    const cur = metric.read(current);
    const prev = previous ? metric.read(previous) : null;
    if (cur === null && prev === null) continue;
    out.push({
      metric: metric.key,
      label: metric.label,
      previous: prev,
      current: cur,
      change: cur !== null && prev !== null ? round(cur - prev, 3) : null,
      direction: direction(prev, cur, metric.higherIsBetter),
      higherIsBetter: metric.higherIsBetter,
    });
  }
  return out;
}

const PAGE_LIST_CAP = 100;
const PAGE_SWING_CAP = 50;

/** Joins the two runs' page sets by URL — what appeared, vanished, or changed score. */
export function comparePages(current: ComparableRun, previous: ComparableRun | null): AuditComparison['pageChanges'] {
  const currentByUrl = new Map(current.pages.map((p) => [p.url, p.score]));
  const previousByUrl = new Map((previous?.pages ?? []).map((p) => [p.url, p.score]));

  const added: string[] = [];
  const removed: string[] = [];
  const swings: Array<{ url: string; from: number; to: number }> = [];

  for (const [url, score] of currentByUrl) {
    if (!previousByUrl.has(url)) {
      added.push(url);
    } else {
      const from = previousByUrl.get(url)!;
      if (from !== score) swings.push({ url, from, to: score });
    }
  }
  for (const url of previousByUrl.keys()) {
    if (!currentByUrl.has(url)) removed.push(url);
  }

  swings.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
  const improved = swings.filter((s) => s.to > s.from).slice(0, PAGE_SWING_CAP);
  const regressed = swings.filter((s) => s.to < s.from).slice(0, PAGE_SWING_CAP);

  return {
    added: added.slice(0, PAGE_LIST_CAP),
    removed: removed.slice(0, PAGE_LIST_CAP),
    improved,
    regressed,
  };
}

/** The full previous-vs-current comparison, assembled from the two pure pieces above. */
export function buildComparison(current: ComparableRun, previous: ComparableRun | null): AuditComparison {
  return {
    currentAuditId: current.id,
    previousAuditId: previous?.id ?? null,
    currentAt: current.createdAt,
    previousAt: previous?.createdAt ?? null,
    deltas: computeDeltas(current, previous),
    pageChanges: comparePages(current, previous),
  };
}
