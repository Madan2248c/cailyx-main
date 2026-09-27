/**
 * Day-1 pipeline constants — env keys and defaults. See
 * docs/analysis/day1-pipeline.md §6.
 *
 * @module day1-pipeline/day1-pipeline.constants
 */

/** CSV answer-engine surfaces for the automatic Day-1 AEO audit. */
export const DAY1_SURFACES_ENV = 'DAY1_SURFACES';
export const DEFAULT_DAY1_SURFACES = 'cloro_chatgpt';

/** Day-1 AEO markets. */
export const DAY1_MARKETS = ['US'];

/** Milliseconds between completion polls of the async (queued) stages. */
export const DAY1_POLL_INTERVAL_ENV = 'DAY1_POLL_INTERVAL_MS';
export const DEFAULT_DAY1_POLL_INTERVAL_MS = 20_000;
