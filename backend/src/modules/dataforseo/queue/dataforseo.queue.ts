/**
 * Queue contract for the DataForSEO pipeline.
 *
 * One queue, two job kinds: manual collects carry their scope inline, and
 * recurring per-project schedules (one job scheduler per project) resolve
 * scope from the schedule row at fire time. Kept in its own file so the
 * producer (`DataforseoService`), the consumer (`DataforseoProcessor`) and
 * the schedule manager (`DataforseoScheduler`) can never drift on the name
 * or payload shape.
 */

import type { JobsOptions } from 'bullmq';

export const DATAFORSEO_QUEUE = 'dataforseo';
export const DATAFORSEO_JOB = 'collect';
/** Recurring per-project job created by the scheduler (scope resolves from the schedule row — the worker advances `next_run_at`). */
export const DATAFORSEO_SCHEDULED_JOB = 'scheduled-run';

export interface DataforseoJobData {
  projectId: string;
  clientId: string;
  datasets?: string[];
  /** Why this job exists. Only for observability — every job collects the same way. */
  reason: 'manual' | 'scheduled' | 'retry';
}

export interface DataforseoScheduledJobData {
  projectId: string;
  reason: 'scheduled';
}

/**
 * Job-level retry covers "the worker crashed or threw something
 * unhandled"; per-dataset isolation inside `collectNow` covers "this
 * dataset's fetch failed". `removeOnComplete`/`removeOnFail` keep Redis
 * from growing without bound — the durable record is the
 * `dataforseo_snapshots` rows, not the queue entry.
 */
export const DATAFORSEO_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

/** A scheduled recurrence never retries as a job — the next interval fires anyway. */
export const DATAFORSEO_SCHEDULED_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: 100,
  removeOnFail: 500,
};
