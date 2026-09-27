/**
 * Every tuned bound for the Gap Analysis module.
 *
 * @module gap-analysis/gap-analysis.constants
 */

export const MIN_RECOMMENDATIONS = 3;
export const MAX_RECOMMENDATIONS = 15;

export const CONSOLIDATE_MAX_TOKENS = 2500;

/** How many of each source's finest-grained rows to include, to keep the LLM prompt bounded on a large run. */
export const MAX_HEADLINES = 10;
export const MAX_COMPETITOR_ROWS = 10;
export const MAX_LOSING_PROMPT_ROWS = 10;
