/**
 * Queue contract for the Day-1 pipeline orchestrator.
 *
 * One queue, one job per `day1_pipeline_runs` row — same shape as the
 * discovery queue contract. Kept in its own file so the producer
 * (`Day1PipelineService`) and the consumer (`Day1PipelineProcessor`) can
 * never drift on the name or the payload shape.
 */

import type { JobsOptions } from 'bullmq';

export const DAY1_QUEUE = 'day1-pipeline';
export const DAY1_JOB = 'run';

export interface Day1JobData {
  pipelineRunId: string;
  projectId: string;
  clientId: string;
}

/**
 * A Day-1 job runs for a long time (queued stages plus blocking LLM/paid
 * stages), so attempts are few and backoff is long — a retry resumes past
 * recorded stages rather than starting over (see the service).
 */
export const DAY1_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};
