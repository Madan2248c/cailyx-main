/**
 * Day-1 pipeline orchestrator module — the automatic end-to-end run.
 *
 * Imports every stage module and calls their exported services (the same
 * collectors pattern gap-analysis and reporting use). No controller: the
 * trigger lives on project creation and the recovery endpoints on
 * `ProjectsController`. See docs/analysis/day1-pipeline.md.
 *
 * @module day1-pipeline/day1-pipeline.module
 */

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DiscoveryModule } from '../discovery/discovery.module.js';
import { TechnicalAuditModule } from '../technical-audit/technical-audit.module.js';
import { SocialActivityModule } from '../social-activity/social-activity.module.js';
import { QuerySetModule } from '../query-set/query-set.module.js';
import { AeoAuditModule } from '../aeo-audit/aeo-audit.module.js';
import { CompetitorsModule } from '../competitors/competitors.module.js';
import { GapAnalysisModule } from '../gap-analysis/gap-analysis.module.js';
import { RemediationModule } from '../remediation/remediation.module.js';
import { ReportingModule } from '../reporting/reporting.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MeasurementModule } from '../measurement/measurement.module.js';
import { DAY1_QUEUE } from './queue/day1-pipeline.queue.js';
import { Day1PipelineProcessor } from './queue/day1-pipeline.processor.js';
import { Day1PipelineService } from './services/day1-pipeline.service.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: DAY1_QUEUE }),
    DiscoveryModule,
    TechnicalAuditModule,
    SocialActivityModule,
    QuerySetModule,
    AeoAuditModule,
    MeasurementModule,
    CompetitorsModule,
    GapAnalysisModule,
    RemediationModule,
    ReportingModule,
    AuthModule,
  ],
  providers: [Day1PipelineProcessor, Day1PipelineService],
  exports: [Day1PipelineService],
})
export class Day1PipelineModule {}
