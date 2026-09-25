/**
 * Every tuned threshold/budget for the Social Activity module in one place.
 * Ported defaults noted; pattern-bucket thresholds are new (approved in
 * docs/analysis/digital-presence-audit.md) — tune here, never inline.
 *
 * @module social-activity/social-activity.constants
 */

export const SOCIAL_QUEUE = 'social-activity';

/** Recent posts pulled per platform per run. The old cost table is priced against 20. */
export const DEFAULT_POSTS_PER_PLATFORM = 20;

/** Aggregation window. Current cadence, not archive history. */
export const DEFAULT_WINDOW_DAYS = 30;

/** Past this, a platform is dormant no matter what its in-window mean says. */
export const DORMANT_AFTER_DAYS = 45;

/** Mean-interval bucket edges, in days. */
export const PATTERN_THRESHOLDS = {
  /** mean <= 1.5 → daily. */
  DAILY_MAX: 1.5,
  /** mean <= 3.5 → every-2-3-days. */
  FREQUENT_MAX: 3.5,
  /** mean <= 8 → weekly. */
  WEEKLY_MAX: 8,
} as const;

/** A sporadic platform goes quiet enough to flag at this many days since last post. */
export const SPORADIC_FLAG_AFTER_DAYS = 14;

/** Default per-run actor-spend ceiling, USD. Same as Technical Audit. */
export const DEFAULT_MAX_COST_PER_RUN_USD = 5.0;

/** Apify run polling: actor runs are minutes, not seconds. */
export const APIFY_POLL_INTERVAL_MS = 5000;
export const APIFY_POLL_TIMEOUT_MS = 10 * 60 * 1000;
