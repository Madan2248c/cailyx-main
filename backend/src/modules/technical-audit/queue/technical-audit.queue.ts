/**
 * Queue contract for the technical-audit pipeline.
 *
 * One queue, one job per `technical_audit_runs` row — see
 * docs/analysis/technical-audit.md "Job orchestration". Kept in its own file
 * so the producer (`TechnicalAuditService`), the consumer
 * (`TechnicalAuditProcessor`) and the schedule manager
 * (`TechnicalAuditScheduler`) can never drift on the name or payload shape.
 */

import type { JobsOptions } from 'bullmq';

export const TECHNICAL_AUDIT_QUEUE = 'technical-audit';
export const TECHNICAL_AUDIT_JOB = 'run';
/** Recurring per-project job created by the scheduler (no run row yet — the worker creates one). */
export const TECHNICAL_AUDIT_SCHEDULED_JOB = 'scheduled-run';

export interface TechnicalAuditJobData {
  auditRunId: string;
  projectId: string;
  /** Why this job exists. Only for observability — every job runs the same eight checks. */
  reason: 'manual' | 'scheduled' | 'retry';
}

export interface TechnicalAuditScheduledJobData {
  projectId: string;
  reason: 'scheduled';
}

/**
 * Job-level retry, which is a **different layer** from the per-check
 * isolation inside `executeRun`: this covers "the worker crashed or threw
 * something unhandled", the check wrapper covers "this one check's fetch
 * failed". Conflating them would retry a whole ~150-page crawl because one
 * probe was rate-limited.
 *
 * `removeOnComplete`/`removeOnFail` keep Redis from growing without bound —
 * the durable record of a run is its `technical_audit_runs` row, not the
 * queue entry.
 */
export const TECHNICAL_AUDIT_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

/** A scheduled recurrence never retries as a job — the next interval fires anyway. */
export const TECHNICAL_AUDIT_SCHEDULED_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: 100,
  removeOnFail: 500,
};
