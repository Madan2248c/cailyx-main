/**
 * Queue contract for the social-activity pipeline.
 *
 * One queue, one job per `social_activity_runs` row — same discipline as
 * Technical Audit. Kept in its own file so the producer
 * (`SocialActivityService`), the consumer (`SocialActivityProcessor`) and
 * the schedule manager (`SocialActivityScheduler`) can never drift on the
 * name or payload shape.
 */

import type { JobsOptions } from 'bullmq';

export const SOCIAL_ACTIVITY_QUEUE = 'social-activity';
export const SOCIAL_ACTIVITY_JOB = 'run';
/** Recurring per-project job created by the scheduler (no run row yet — the worker creates one). */
export const SOCIAL_ACTIVITY_SCHEDULED_JOB = 'scheduled-run';

export interface SocialActivityJobData {
  socialActivityRunId: string;
  projectId: string;
  /** Why this job exists. Only for observability — every job pulls the same way. */
  reason: 'manual' | 'scheduled' | 'retry';
}

export interface SocialActivityScheduledJobData {
  projectId: string;
  reason: 'scheduled';
}

/**
 * Job-level retry covers "the worker crashed or threw something unhandled";
 * per-platform isolation inside `executeRun` covers "this actor failed".
 * `removeOnComplete`/`removeOnFail` keep Redis from growing without bound —
 * the durable record is the `social_activity_runs` row, not the queue entry.
 */
export const SOCIAL_ACTIVITY_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

/** A scheduled recurrence never retries as a job — the next interval fires anyway. */
export const SOCIAL_ACTIVITY_SCHEDULED_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: 100,
  removeOnFail: 500,
};
