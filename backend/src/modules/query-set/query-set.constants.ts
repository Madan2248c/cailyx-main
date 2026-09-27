/**
 * Every tuned threshold/budget for the Query Set module in one place.
 * See docs/analysis/query-set.md "Guardrails" — these are enforced in code
 * on the LLM's raw proposal, deterministic regardless of what the model
 * invents.
 *
 * @module query-set/query-set.constants
 */

/** Bucket count bounds — below 4 can't cover the funnel meaningfully; above 14, buckets thin out. */
export const MIN_BUCKETS = 4;
export const MAX_BUCKETS = 14;

/** Per-bucket prompt count bounds. */
export const MIN_PROMPTS_PER_BUCKET = 5;
export const MAX_PROMPTS_PER_BUCKET = 40;

/** At least this fraction of total prompts must come from unbranded buckets. */
export const UNBRANDED_RATIO_FLOOR = 0.7;

/**
 * Target total-set-size tiers. Not pinned to an exact number in the analysis
 * doc (only "100-300 for a full set, smaller on constrained tiers") — these
 * are this build's own defaults, flagged for the coordinator to confirm.
 */
export const TIER_TARGET_SIZES: Record<string, number> = {
  starter: 60,
  full: 200,
};
export const DEFAULT_TIER = 'full';

/**
 * A grounding term shorter than this is too generic to count as evidence a
 * rationale actually cites something specific (e.g. "SaaS", "US" alone).
 */
export const MIN_GROUNDING_TERM_LENGTH = 4;
