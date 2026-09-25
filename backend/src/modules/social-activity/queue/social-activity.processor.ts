/**
 * BullMQ consumer for the social-activity queue.
 *
 * Thin on purpose: the worker hands the run id to
 * `SocialActivityService.executeRun` (manual jobs) or resolves the schedule
 * row first (recurrences). All spend gates, isolation and persistence live
 * in the orchestrator.
 *
 * Concurrency is deliberately 1: each run spends real actor credit and hits
 * platform rate limits. Never two runs for one project concurrently (the
 * orchestrator's `startRun` returns the active row instead of creating a
 * second one).
 */

import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SocialActivityScheduler } from '../services/social-activity.scheduler.js';
import { SocialActivityService } from '../services/social-activity.service.js';
import {
  SOCIAL_ACTIVITY_QUEUE,
  SOCIAL_ACTIVITY_SCHEDULED_JOB,
  type SocialActivityJobData,
  type SocialActivityScheduledJobData,
} from './social-activity.queue.js';

@Processor(SOCIAL_ACTIVITY_QUEUE, { concurrency: 1 })
export class SocialActivityProcessor extends WorkerHost {
  private readonly logger = new Logger(SocialActivityProcessor.name);

  constructor(
    private readonly activity: SocialActivityService,
    private readonly schedules: SocialActivityScheduler,
  ) {
    super();
  }

  async process(job: Job<SocialActivityJobData | SocialActivityScheduledJobData>): Promise<void> {
    if (job.name === SOCIAL_ACTIVITY_SCHEDULED_JOB) {
      // A recurrence carries no run row and no spend of its own —
      // both resolve from the project's schedule row at fire time.
      // Anything but a freshly created SCHEDULED row means skip: no opt-in,
      // another run active, or a lost race — none of them execute here.
      const { projectId } = job.data as SocialActivityScheduledJobData;
      const tick = await this.schedules.fireScheduledTick(projectId);
      if (tick === 'skipped') {
        this.logger.debug(`Scheduled social-activity tick for project ${projectId} skipped.`);
        return;
      }
      await this.activity.executeRun(tick.id);
      return;
    }
    await this.activity.executeRun((job.data as SocialActivityJobData).socialActivityRunId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error) {
    this.logger.error(`Social activity job ${job?.id ?? 'unknown'} failed: ${err.message}`);
  }
}
