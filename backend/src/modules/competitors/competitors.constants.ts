/**
 * Every tuned bound for the Competitors module.
 *
 * @module competitors/competitors.constants
 */

/** One homepage fetch per domain, cached — this is a profile scan, not a crawl. */
export const HOMEPAGE_FETCH_TIMEOUT_MS = 20_000;
export const HOMEPAGE_CACHE_TTL_SECONDS = 3600;

/** Category-level SERP queries per discovery run — small and bounded, per the analysis doc. */
export const MAX_SERP_QUERIES = 3;
/** Distinct ranking domains kept per query (DataForSEO's own depth is 10; this trims further). */
export const MAX_SERP_DOMAINS_PER_QUERY = 10;

/** Evidence snippets are truncated so a giant inline script never bloats a row. */
export const EVIDENCE_MAX_LEN = 200;
