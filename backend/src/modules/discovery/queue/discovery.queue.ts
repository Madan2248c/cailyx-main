/**
 * Queue contract for the discovery pipeline.
 *
 * One queue, one job per `discovery_runs` row — see docs/analysis/discovery.md
 * "Job orchestration". Kept in its own file so the producer (`DiscoveryService`)
 * and the consumer (`DiscoveryProcessor`) can never drift on the name or the
 * payload shape.
 */

import type { JobsOptions } from 'bullmq';

export const DISCOVERY_QUEUE = 'discovery';
export const DISCOVERY_JOB = 'run';

export interface DiscoveryJobData {
  discoveryRunId: string;
  projectId: string;
  /**
   * Why this job exists. Only for observability — a job behaves identically
   * whatever the reason; a paused run's continuation is just another job.
   */
  reason: 'project-created' | 'manual' | 'continuation' | 'retry';
}

/**
 * Job-level retry, which is a **different layer** from the per-page retry inside
 * the extract stage: this covers "the worker crashed or threw something
 * unhandled", the page-level retry covers "this one page's fetch or LLM call
 * failed". Conflating them would silently retry a whole run because one page
 * was rate-limited.
 *
 * `removeOnComplete`/`removeOnFail` keep Redis from growing without bound —
 * the durable record of a run is its `discovery_runs` row, not the queue entry.
 */
export const DISCOVERY_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

/**
 * A continuation job for a paused run. Deliberately its own options: a
 * self-imposed pause is not a failure, so it gets a fresh set of attempts and
 * no backoff — waiting here would only make a legitimately long pipeline
 * slower.
 */
export const DISCOVERY_CONTINUATION_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  removeOnComplete: 100,
  removeOnFail: 500,
};
