/**
 * Gap Analysis vocabulary — the consolidated recommendation shape and the
 * flat, citable finding format every source collector normalizes into.
 *
 * @module gap-analysis/gap-analysis.types
 */

export type SourceModule = 'technical-audit' | 'social-activity' | 'aeo-audit';

/**
 * One atomic, citable unit of source data — a finding, a delta, a
 * headline, a competitor-standing row. `findingRef` is stable within one
 * run's collected data and is exactly what a recommendation's
 * `sourceFindings` cites; the rationale-grounding guardrail checks a
 * citation against this exact list, never against the raw run rows.
 */
export interface SourceFinding {
  module: SourceModule;
  findingRef: string;
  /** Grounding text fed to the LLM and scanned for fabricated numbers — everything the model is allowed to know about this finding. */
  summary: string;
}

/** One source module's collected data for a project, or null when it has no completed run. */
export interface CollectedSource {
  module: SourceModule;
  runId: string;
  findings: SourceFinding[];
}

/** One recommendation as the LLM proposes it, before validation. */
export interface RawRecommendation {
  title: string;
  description: string;
  sourceFindings: Array<{ module: SourceModule; findingRef: string }>;
}

/** A recommendation that survived every guardrail, with its final rank. */
export interface ValidatedRecommendation {
  title: string;
  description: string;
  priorityRank: number;
  sourceFindings: Array<{ module: SourceModule; findingRef: string }>;
}

export interface GuardrailNote {
  type: 'ungrounded-citation' | 'fabricated-number' | 'item-count-low' | 'item-count-high';
  detail: string;
  title?: string;
}
