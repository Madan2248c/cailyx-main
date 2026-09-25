/**
 * Social Activity module — Stage 3 of the Day-1 pipeline (alongside
 * Technical Audit): audits a company's social publishing activity.
 *
 * Consumes Discovery's verified `social_profiles` (never re-discovers),
 * pulls recent posts via Apify actors behind a dual spend gate, aggregates
 * per-platform cadence over a 30-day window, and stores dormant/infrequent
 * findings. See docs/analysis/digital-presence-audit.md for the design and
 * `README.md` next to this file for the operational notes.
 *
 * One BullMQ queue (`social-activity`, concurrency 1) carries both manual
 * runs (one job per `social_activity_runs` row) and recurring schedules (one
 * job scheduler per project — the worker creates the run at fire time, and
 * only when the project opted into spend). Same Redis instance as the other
 * queues — one Redis config, independent consumers.
 */

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module.js';
import {
  SocialActivityController,
  SocialActivityRunController,
} from './controllers/social-activity.controller.js';
import { SOCIAL_ACTIVITY_QUEUE } from './queue/social-activity.queue.js';
import { SocialActivityProcessor } from './queue/social-activity.processor.js';
import { ApifyService } from './services/apify.service.js';
import { SocialActivityScheduler } from './services/social-activity.scheduler.js';
import { SocialActivityService } from './services/social-activity.service.js';

@Module({
  imports: [LlmModule, BullModule.registerQueue({ name: SOCIAL_ACTIVITY_QUEUE })],
  controllers: [SocialActivityController, SocialActivityRunController],
  providers: [
    // The queue consumer, the schedule manager, the spend-gated adapter,
    // and the orchestrator that does the real work.
    SocialActivityProcessor,
    SocialActivityScheduler,
    ApifyService,
    SocialActivityService,
  ],
  exports: [SocialActivityService],
})
export class SocialActivityModule {}
