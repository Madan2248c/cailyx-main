/**
 * Tuned constants for the technical-audit pipeline — every threshold and
 * budget the checks use.
 *
 * Ported verbatim from the old repo's `technical-audit/` module (the
 * orchestrator's inline checks and `checks/seo-rubric.ts`), the shipped,
 * battle-tested implementation. Same discipline as Discovery's
 * `discovery.constants.ts`: these numbers are not "cleaned up" or
 * re-derived — several carry their own sourcing (Backlinko/Moz for the URL
 * band, Google's own published Core Web Vitals thresholds), and a value
 * here should only change because a real run showed it was wrong.
 *
 * @module technical-audit/technical-audit.constants
 */

import type { PageIssueCode } from './technical-audit.types.js';

// ─── Crawl budgets ──────────────────────────────────────────────────────────

export const DEFAULT_PAGE_CRAWL_BUDGET = 150;
export const DEFAULT_PAGE_CRAWL_CONCURRENCY = 6;
/** Soft ceiling only — logged when exceeded after a run, never aborts or throttles mid-run. */
export const DEFAULT_MAX_COST_PER_RUN_USD = 5.0;

// ─── Sitemap ────────────────────────────────────────────────────────────────

export const SITEMAP_FALLBACK_PATHS = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml', '/sitemap'] as const;
/** A sitemap index can point at hundreds of children; bound the fan-out. */
export const MAX_CHILD_SITEMAPS = 20;
/** Guard against a pathological sitemap blowing out memory. */
export const MAX_SITEMAP_ENTRIES = 50_000;

// ─── SEO rubric bands ───────────────────────────────────────────────────────

export const SEO_BANDS = {
  titleMin: 30,
  titleMax: 60,
  metaMin: 70,
  metaMax: 160,
  /** Word-count floor below which a page is "thin". */
  minWords: 150,
  maxMissingAltRatio: 0.25,
  urlMaxLength: 115,
  urlMaxParams: 3,
} as const;

/**
 * Score = `100 − Σ deductions`, clamped to ≥ 0. Deliberately not
 * additive-safe to 100 — checks can and do overlap (a page can be both
 * thin-content and have a missing meta description).
 */
export const SEO_DEDUCTIONS: Record<PageIssueCode, number> = {
  'page-error': 100,
  noindex: 100,
  'json-ld-missing': 20,
  'title-missing': 20,
  'canonical-cross-domain': 18,
  'meta-missing': 15,
  'h1-missing': 12,
  'canonical-malformed': 10,
  'json-ld-invalid': 10,
  'thin-content': 10,
  'duplicate-content': 10,
  'images-missing-alt': 8,
  'title-too-long': 8,
  'title-too-short': 8,
  'canonical-missing': 8,
  'heading-level-skipped': 6,
  'meta-too-long': 6,
  'meta-too-short': 6,
  'h1-multiple': 6,
  'url-excess-params': 5,
  'url-too-long': 4,
  'url-has-uppercase': 4,
  'url-has-underscore': 3,
};

/** "Worst pages" list length in `PageInventoryAnalysis`. */
export const WORST_PAGES_LIMIT = 20;

// ─── Composite score ────────────────────────────────────────────────────────

/**
 * Weights sum to 100. Missing components are dropped and the remaining
 * weights renormalized (see docs/analysis/technical-audit.md "Composite
 * score") — a deliberate, documented exception to a "never renormalize"
 * rule used elsewhere in this codebase, not an oversight.
 */
export const COMPOSITE_WEIGHTS = {
  access: 25,
  rendering: 15,
  structured: 20,
  content: 15,
  performance: 15,
  agent: 10,
} as const;

// ─── Core Web Vitals bands (Google's own published thresholds) ─────────────

export const CWV_BANDS = {
  lcp: { good: 2500, needsImprovement: 4000 }, // ms
  cls: { good: 0.1, needsImprovement: 0.25 },
  inp: { good: 200, needsImprovement: 500 }, // ms
} as const;

// ─── Agent readiness (is-agentic CLI/API) ──────────────────────────────────

export const AGENT_READINESS_DEFAULT_TIMEOUT_MS = 180_000;
/** The read-only API fallback path's own, shorter timeout. */
export const AGENT_READINESS_API_TIMEOUT_MS = 15_000;

// ─── Job orchestration ──────────────────────────────────────────────────────

/** No multi-stage pause/resume here — see docs/analysis/technical-audit.md "Job orchestration". */
export const DEFAULT_JOB_TIMEOUT_MS = 10 * 60 * 1000;
