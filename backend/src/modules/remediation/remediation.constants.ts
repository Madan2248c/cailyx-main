/**
 * Every tuned bound for the Remediation module.
 *
 * @module remediation/remediation.constants
 */

/** At most this many page-level fix specs per sync, worst pages first — keeps a 150-page crawl from producing 1,000 rows. */
export const MAX_PAGE_SPECS = 150;

/** Per-project cap on LLM copy drafts in a rolling 24h window (env `REMEDIATION_MAX_DRAFTS_PER_DAY` overrides). */
export const DEFAULT_MAX_DRAFTS_PER_DAY = 20;

export const DRAFT_MAX_TOKENS = 1500;

/** Losing AEO prompts turned into content fixes per sync. */
export const MAX_AEO_PROMPT_SPECS = 15;

/** Failed Lighthouse audits listed on a performance fix. */
export const MAX_CWV_AUDITS_LISTED = 8;

/**
 * Page issue codes that become their own per-page fix spec. The rest of the
 * rubric's codes (url-*, heading-level-skipped, images-missing-alt,
 * duplicate-content, thin-content, page-error, noindex, json-ld-*) are
 * grouped into one site-level spec per code with the affected pages listed,
 * because the fix is the same template change for all of them.
 */
export const PER_PAGE_ISSUES = [
  'title-missing',
  'title-too-short',
  'title-too-long',
  'meta-missing',
  'meta-too-short',
  'meta-too-long',
  'h1-missing',
  'h1-multiple',
  'canonical-missing',
  'canonical-malformed',
  'canonical-cross-domain',
] as const;

/** Pages listed in a grouped (site-level) page-issue spec's evidence. */
export const MAX_GROUPED_PAGES_LISTED = 25;
