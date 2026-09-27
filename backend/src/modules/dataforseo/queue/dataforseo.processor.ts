/**
 * BullMQ consumer for the DataForSEO queue.
 *
 * Thin on purpose: the worker hands manual jobs straight to
 * `DataforseoService.collectNow` and resolves recurrences through
 * `DataforseoScheduler.fireScheduledTick` first (no opt-in, not due, or
 * project gone all mean skip — no rows, no spend). All gating, isolation
 * and persistence live in the service/scheduler, so they are reachable
 * from a test without a Redis instance.
 *
 * Concurrency is deliberately 1: every collect is a (future-live) paid
 * pull. Never two collects for one project concurrently — same
 * discipline as the other pipeline modules.
 */

import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { DataforseoService } from '../services/dataforseo.service.js';
import { DataforseoScheduler } from '../services/dataforseo.scheduler.js';
import {
  DATAFORSEO_QUEUE,
  DATAFORSEO_SCHEDULED_JOB,
  type DataforseoJobData,
  type DataforseoScheduledJobData,
} from './dataforseo.queue.js';

@Processor(DATAFORSEO_QUEUE, { concurrency: 1 })
export class DataforseoProcessor extends WorkerHost {
  private readonly logger = new Logger(DataforseoProcessor.name);

  constructor(
    private readonly dataforseo: DataforseoService,
    private readonly schedules: DataforseoScheduler,
  ) {
    super();
  }

  async process(job: Job<DataforseoJobData | DataforseoScheduledJobData>): Promise<void> {
    if (job.name === DATAFORSEO_SCHEDULED_JOB) {
      // A recurrence carries no snapshots and no spend of its own —
      // both resolve from the project's schedule row at fire time.
      // Anything but a collect result means skip: no opt-in, not due,
      // or the project is gone — none of them collect here.
      const { projectId } = job.data as DataforseoScheduledJobData;
      const tick = await this.schedules.fireScheduledTick(projectId);
      if (tick === 'skipped') {
        this.logger.debug(`Scheduled DataForSEO tick for project ${projectId} skipped.`);
        return;
      }
      this.logger.log(`Scheduled DataForSEO collect for project ${projectId}: ${tick.snapshots.length} snapshots.`);
      return;
    }
    const data = job.data as DataforseoJobData;
    await this.dataforseo.collectNow(data.clientId, data.projectId, data.datasets);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error) {
    this.logger.error(`DataForSEO job ${job?.id ?? 'unknown'} failed: ${err.message}`);
  }
}
