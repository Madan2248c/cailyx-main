/**
 * BullMQ consumer for the Day-1 pipeline queue.
 *
 * Thin on purpose: the worker hands the pipeline id to
 * `Day1PipelineService.executePipeline` and reports the current stage as
 * job progress. All sequencing/resume logic lives in the service, so it is
 * reachable from a test without a Redis instance.
 */

import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Day1PipelineService } from '../services/day1-pipeline.service.js';
import { DAY1_QUEUE, type Day1JobData } from './day1-pipeline.queue.js';

@Processor(DAY1_QUEUE)
export class Day1PipelineProcessor extends WorkerHost {
  private readonly logger = new Logger(Day1PipelineProcessor.name);

  constructor(private readonly pipeline: Day1PipelineService) {
    super();
  }

  async process(job: Job<Day1JobData>): Promise<void> {
    await this.pipeline.executePipeline(job.data.pipelineRunId, (stage) => job.updateProgress(stage));
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<Day1JobData>, error: Error): void {
    const attempts = job.attemptsMade;
    const max = job.opts.attempts ?? 1;
    const giveUp = attempts >= max;
    const message = `Day-1 job ${job.id} (project ${job.data.projectId}) failed on attempt ${attempts}/${max}: ${error.message}`;
    if (giveUp) {
      this.logger.error(`${message}. No attempts left.`);
    } else {
      this.logger.warn(`${message}. Will retry.`);
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<Day1JobData>): void {
    this.logger.log(`Day-1 job ${job.id} finished (project ${job.data.projectId}).`);
  }
}
