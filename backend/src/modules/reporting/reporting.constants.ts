/**
 * Every tuned bound for the Reporting module.
 *
 * @module reporting/reporting.constants
 */

export const NARRATIVE_MAX_TOKENS = 900;

/** The agency named on the downloadable PDF's cover and footer. */
export const REPORT_BRAND_NAME = 'Rothenhall Partners';

/** Sections ranked worst-first for DAY1 by counting these signals per section. */
export const DEFAULT_SECTION_ORDER = ['technicalAudit', 'aeoAudit', 'socialActivity', 'competitors', 'gapAnalysis'] as const;
