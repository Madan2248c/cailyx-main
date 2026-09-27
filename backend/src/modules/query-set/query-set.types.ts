/**
 * Query Set module vocabulary — buckets, proposals, and the guardrail
 * outcomes that turn an LLM's raw invention into a persisted, bounded set.
 * See docs/analysis/query-set.md.
 *
 * @module query-set/query-set.types
 */

export type FunnelStage = 'problem_aware' | 'solution_aware' | 'product_aware' | 'most_aware';
export const FUNNEL_STAGES: readonly FunnelStage[] = [
  'problem_aware',
  'solution_aware',
  'product_aware',
  'most_aware',
];

export type PromptPersona = 'buyer' | 'researcher' | 'end_user' | 'evaluator';
export const PROMPT_PERSONAS: readonly PromptPersona[] = ['buyer', 'researcher', 'end_user', 'evaluator'];

export type PromptBranding = 'branded' | 'unbranded';

/** LLM call #1's raw output for one bucket, before any guardrail has run. */
export interface BucketProposal {
  name: string;
  rationale: string;
  persona: PromptPersona;
  funnelStage: FunnelStage;
  branding: PromptBranding;
  targetCount: number;
}

/** One reason a proposal or bucket was rejected/adjusted — surfaced in the API response for visibility. */
export interface GuardrailNote {
  type: 'bucket-count-low' | 'bucket-count-high' | 'per-bucket-clamped' | 'scaled-to-tier' | 'unbranded-floor' | 'ungrounded-rationale';
  detail: string;
  bucketName?: string;
}

/** Guardrails applied, in order, over the raw proposal. */
export interface GuardrailResult {
  buckets: BucketProposal[];
  notes: GuardrailNote[];
}

/** Flattened, searchable grounding terms pulled from a CompanyContextProfile. */
export type GroundingContext = string[];

/** LLM call #2's raw output for one bucket. */
export interface GeneratedPrompt {
  prompt: string;
}
