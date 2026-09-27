/**
 * Day-1 pipeline types — the stage keys, per-stage records, and the
 * persisted pipeline shape. See docs/analysis/day1-pipeline.md.
 *
 * @module day1-pipeline/day1-pipeline.types
 */

/** Stages in execution order. `notify` is the final "audit is ready" email. */
export const DAY1_STAGES = [
  'discovery',
  'technical-audit',
  'social-activity',
  'query-set',
  'aeo-audit',
  'competitors',
  'gap-analysis',
  'reporting',
  'notify',
] as const;

export type Day1Stage = (typeof DAY1_STAGES)[number];

/** Async (BullMQ-backed, poll-for-completion) stages. */
export const ASYNC_STAGES: readonly Day1Stage[] = ['discovery', 'technical-audit', 'social-activity'];

/** Paid stages — gated by the spend ceiling check before they start. */
export const PAID_STAGES: readonly Day1Stage[] = ['social-activity', 'aeo-audit'];

export type Day1StageState = 'completed' | 'failed' | 'skipped';

export interface Day1StageRecord {
  status: Day1StageState;
  /** The stage's run/audit/set id, when it has one (competitors has none). */
  runId?: string;
  error?: string;
  skippedReason?: string;
}

export type Day1StagesState = Partial<Record<Day1Stage, Day1StageRecord>>;

export interface StartPipelineOptions {
  spendCeilingUsd?: number;
}
