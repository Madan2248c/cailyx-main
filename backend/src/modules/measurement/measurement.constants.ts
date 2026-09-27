/**
 * Every tuned threshold/budget for the Measurement module in one place.
 *
 * @module measurement/measurement.constants
 */

/** Repeat count per prompt. Lowered from a hard n>=5 floor to 1 on explicit
 *  operator instruction (ported from the old repo's own recorded override)
 *  — a runCount:1 result is a single sample, not a rate. */
export const MIN_RUN_COUNT = 1;

/** Per-run cost ceiling default, USD — same convention as Technical Audit / Social Activity. */
export const DEFAULT_MAX_COST_PER_RUN = 5.0;

export const CLORO_BASE_URL = 'https://api.cloro.dev';
export const CLORO_POLL_INTERVAL_MS = 3000;
export const CLORO_POLL_TIMEOUT_MS = 120_000;
/** Per-HTTP-call timeout — Cloro's task-status endpoints should answer immediately. */
export const CLORO_REQUEST_TIMEOUT_MS = 30_000;
/** Highest `CLORO_API_KEY<N>` suffix checked for the multi-account fallback. */
export const CLORO_MAX_KEY_SUFFIX = 20;
/** Fallback credit-to-USD rate when a run doesn't report `CLORO_CREDIT_USD`. */
export const DEFAULT_CLORO_CREDIT_USD = 0.0004;
