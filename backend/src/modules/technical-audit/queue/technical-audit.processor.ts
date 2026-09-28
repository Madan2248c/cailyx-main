/**
 * BullMQ consumer for the technical-audit queue.
 *
 * Thin on purpose: the worker's only job is to hand the run id to
 * `TechnicalAuditService.executeRun`. All the per-check isolation, scoring
 * and persistence lives in the orchestrator, so it is reachable from a test
 * without a Redis instance.
 *
 * Concurrency is deliberately 1: each audit drives a browser render, a PSI
 * call and a ~150-page crawl. Running several concurrently risks the cost
 * ceiling and rate limits at the same time — see
 * docs/analysis/technical-audit.md "Scheduling".
 */

import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { TechnicalAuditService } from '../services/technical-audit.service.js';
import {
  TECHNICAL_AUDIT_QUEUE,
  TECHNICAL_AUDIT_SCHEDULED_JOB,
  type TechnicalAuditJobData,
  type TechnicalAuditScheduledJobData,
} from './technical-audit.queue.js';

@Processor(TECHNICAL_AUDIT_QUEUE, { concurrency: 1 })
export class TechnicalAuditProcessor extends WorkerHost {
  private readonly logger = new Logger(TechnicalAuditProcessor.name);

  constructor(private readonly audits: TechnicalAuditService) {
    super();
  }

  async process(job: Job<TechnicalAuditJobData | TechnicalAuditScheduledJobData>): Promise<void> {
    if (job.name === TECHNICAL_AUDIT_SCHEDULED_JOB) {
      // A recurrence carries no run row — the run is created now, so the
      // previous-run chain resolves against the latest scored run at fire
      // time, not at schedule time.
      const { projectId } = job.data as TechnicalAuditScheduledJobData;
      const run = await this.audits.startRun(projectId, 'scheduled');
      // `startRun` returns the active run instead of creating a second one
      // when a manual trigger is already in flight — executing that active
      // row here would double-execute the manual job's own worker. Only
      // execute when this scheduler tick created the row it is holding.
      if (run.triggeredBy === 'SCHEDULED' && run.status === 'QUEUED') {
        await this.audits.executeRun(run.id);
      } else {
        this.logger.debug(`Scheduled tick for project ${projectId} skipped. Run ${run.id} already ${run.status}.`);
      }
      return;
    }
    await this.audits.executeRun((job.data as TechnicalAuditJobData).auditRunId);
  }

  /**
   * A failed job is not necessarily a failed run: `executeRun` rethrows so
   * BullMQ's attempts/backoff can retry, and the run row already carries the
   * terminal state when the failure is final. Logging the attempt count here
   * is what distinguishes "trying again" from "gave up" in the logs — the
   * run row alone cannot show that.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error): void {
    const attempts = job.attemptsMade;
    const max = job.opts.attempts ?? 1;
    const giveUp = attempts >= max;
    const message = `Technical audit job ${job.id} failed on attempt ${attempts}/${max}: ${error.message}`;
    if (giveUp) {
      this.logger.error(`${message}. No attempts left.`);
    } else {
      this.logger.warn(`${message}. Will retry.`);
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job): void {
    this.logger.log(`Technical audit job ${job.id} finished (${job.name}).`);
  }
}
