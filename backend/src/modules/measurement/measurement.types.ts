/**
 * Measurement Types — AI surface observation runs (SOP-2).
 *
 * Rates, never positions: everything downstream reports normalized rates
 * ("cited in 3 of 5 runs"); structured Observations are what compute them.
 *
 * @module measurement/measurement.types
 */

export type Surface = 'cloro_chatgpt' | 'cloro_perplexity' | 'cloro_gemini' | 'cloro_ai_overview' | 'cloro_ai_mode' | 'mock';

export const SURFACES: readonly Surface[] = [
  'cloro_chatgpt',
  'cloro_perplexity',
  'cloro_gemini',
  'cloro_ai_overview',
  'cloro_ai_mode',
  'mock',
];

/** PRD-style structured per-observation record. */
export interface SurfaceAnswer {
  /** The natural-language answer text as shown to a user of the surface. */
  text: string;
  /** URLs the surface cited (order = result order on the surface). */
  citations: string[];
  costUsd: number;
  latencyMs: number;
  model: string;
}

/** One `Surface` adapter — add a new surface later without touching the service. */
export interface SurfaceAdapter {
  readonly name: Surface;
  /** Ask one question, fresh session, return the answer + citations. */
  runPrompt(prompt: string, geo: string): Promise<SurfaceAnswer>;
}

/** Request body for creating a run. */
export interface CreateRunInput {
  querySetId: string;
  surface: Surface;
  geo?: string;
  runCount?: number;
}

/**
 * Aggregated metric block. **Cohort.** No `runId` → every observation ever
 * stored for the project (the cumulative record, not a comparable period).
 * `runId` → that one run's observations (one query set, one surface, one
 * geo, one point in time — a comparable cohort). The two answer different
 * questions; `observations` always says which one was computed.
 *
 * **Empty is unmeasured, not zero.** A cohort with no observations returns
 * `null` rates — never `0`, which would read as "measured, never mentioned".
 *
 * `shareOfVoice` is always `[]` in this build: no competitor data source is
 * wired into this repo yet (the old repo read `Project.competitors`, which
 * doesn't exist here). Documented gap, not a silent omission.
 */
export interface MeasurementSummary {
  /** Every measurement run ever created for the project, any status. */
  runs: number;
  /** The size of the cohort the rates below were computed over. */
  observations: number;
  mentionRate: number | null;
  citationRate: number | null;
  bySurface: Array<{ surface: string; observations: number; mentionRate: number; citationRate: number }>;
  byFunnelStage: Array<{ funnelStage: string; observations: number; mentionRate: number; citationRate: number }>;
  /** Always empty — see the type doc above. */
  shareOfVoice: Array<{ name: string; share: number }>;
}
