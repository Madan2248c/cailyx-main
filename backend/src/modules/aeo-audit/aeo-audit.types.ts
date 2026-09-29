/**
 * AEO Audit vocabulary — ties an active query set to one or more
 * Measurement runs, judges stance, assembles a verdict. See module README.
 *
 * @module aeo-audit/aeo-audit.types
 */

export type Stance = 'recommended_primary' | 'recommended_alternative' | 'mentioned_neutral' | 'mentioned_negative' | 'absent';

export const STANCES: readonly Stance[] = ['recommended_primary', 'recommended_alternative', 'mentioned_neutral', 'mentioned_negative', 'absent'];

/** One dimension's rate slice — always a real fraction over a non-empty cohort; empty cohorts are omitted, never zeroed. */
export interface SliceMetrics {
  observations: number;
  mentionRate: number;
  citationRate: number;
}

export interface CompetitorStanding {
  name: string;
  /** Times the subject was recorded ahead of this rival across judged observations. */
  timesAhead: number;
  /** Times the subject was recorded behind this rival. */
  timesBehind: number;
  /** Times both appeared without an explicit ranking between them. */
  coMentions: number;
}

/** The stance-judgment view of a run: raw counts, never a weighted score. */
export interface JudgedSummary {
  stanceCounts: Record<Stance, number>;
  /** Up to 25, sorted by how many rivals it lost to. */
  losingPrompts: Array<{ observationId: string; prompt: string; losesTo: string[] }>;
  /** Up to 25, `stance: recommended_primary` only. */
  winningPrompts: Array<{ observationId: string; prompt: string }>;
}

/**
 * The full assembled verdict — a cache of what's derivable from stored
 * rows at any time (`GET .../verdict` recomputes this fresh, side-effect
 * free). No composite score: this repo's own rule, ported faithfully from
 * the old module, which computed none either.
 */
export interface AeoVerdict {
  counted: {
    overall: SliceMetrics;
    unbranded: SliceMetrics | null;
    branded: SliceMetrics | null;
    byBucket: Array<{ bucket: string } & SliceMetrics>;
    byFunnelStage: Array<{ funnelStage: string } & SliceMetrics>;
    bySurface: Array<{ surface: string } & SliceMetrics>;
    competitorStanding: CompetitorStanding[];
  };
  judged: JudgedSummary | null;
  /** Hand-composed sentences quoting the raw numbers above. The only place a threshold (5pp engine-unevenness) is applied. */
  headlines: string[];
  /** Best-effort prose, never invents a number. Absent until generated. */
  narrative?: string[];
}

/** One stance-judgment LLM response, before validation. */
export interface StanceJudgment {
  stance: Stance;
  rankAmongBrands: number | null;
  brandsNamed: string[];
  /** Names the judge marked as direct competitors of the subject; undefined when an older judge run did not say. */
  directCompetitors?: string[];
  recommendedOver: string[];
  losesTo: string[];
  otherNamesSeen: string[];
  evidenceQuote: string | null;
  rationale: string | null;
}
