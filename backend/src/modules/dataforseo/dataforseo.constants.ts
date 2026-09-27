/**
 * Every tuned threshold/budget for the DataForSEO module in one place.
 * Tune here, never inline.
 *
 * @module dataforseo/dataforseo.constants
 */

/** Per-run spend ceiling default, USD — same convention as Technical Audit / Social Activity / Measurement. */
export const DEFAULT_MAX_COST_PER_RUN_USD = 5.0;

/** Mock fixture cost booked per dataset snapshot — an estimate, never a billed figure. */
export const MOCK_COST_PER_DATASET_USD = 0.01;

/** Default lookback window a snapshot's period covers. */
export const DEFAULT_PERIOD_DAYS = 30;

/** Snapshot list page size (capped in the service). */
export const DEFAULT_SNAPSHOT_TAKE = 20;
export const MAX_SNAPSHOT_TAKE = 100;
