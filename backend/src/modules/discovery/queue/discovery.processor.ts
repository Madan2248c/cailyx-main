/**
 * BullMQ consumer for the discovery queue.
 *
 * Thin on purpose: the worker's only job is to hand the run id to
 * `DiscoveryService.executeRun` and report the current stage as job progress.
 * All the resume/checkpoint/pause logic lives in the orchestrator, so it is
 * reachable from a test without a Redis instance.
 */

import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { DiscoveryService } from '../services/discovery.service.js';
import { DISCOVERY_QUEUE, type DiscoveryJobData } from './discovery.queue.js';

@Processor(DISCOVERY_QUEUE)
export class DiscoveryProcessor extends WorkerHost {
  private readonly logger = new Logger(DiscoveryProcessor.name);

  constructor(private readonly discovery: DiscoveryService) {
    super();
  }

  async process(job: Job<DiscoveryJobData>): Promise<void> {
    await this.discovery.executeRun(job.data.discoveryRunId, {
      onProgress: (stage) => job.updateProgress(stage),
    });
  }

  /**
   * A failed job is not necessarily a failed run: `executeRun` rethrows so
   * BullMQ's attempts/backoff can retry, and the run row already carries the
   * error. Logging the attempt count here is what distinguishes "trying again"
   * from "gave up" in the logs — the run row alone cannot show that.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<DiscoveryJobData>, error: Error): void {
    const attempts = job.attemptsMade;
    const max = job.opts.attempts ?? 1;
    const giveUp = attempts >= max;
    const message = `Discovery job ${job.id} (run ${job.data.discoveryRunId}) failed on attempt ${attempts}/${max}: ${error.message}`;
    if (giveUp) {
      this.logger.error(`${message}. No attempts left.`);
    } else {
      this.logger.warn(`${message}. Will retry.`);
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<DiscoveryJobData>): void {
    this.logger.log(`Discovery job ${job.id} finished (run ${job.data.discoveryRunId}, reason: ${job.data.reason}).`);
  }
}
