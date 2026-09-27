/**
 * Reporting module (SOP-11) — assembles a report from the latest
 * completed run of Technical Audit, Social Activity, AEO Audit,
 * Competitors, and Gap Analysis (read-only, via each module's own
 * exported service), renders it, and gates client visibility through an
 * editorial lifecycle (bypassed for DAY1). One `kind` column, not two
 * systems. See `README.md`.
 */

import { Module } from '@nestjs/common';
import { AeoAuditModule } from '../aeo-audit/aeo-audit.module.js';
import { CompetitorsModule } from '../competitors/competitors.module.js';
import { GapAnalysisModule } from '../gap-analysis/gap-analysis.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { SocialActivityModule } from '../social-activity/social-activity.module.js';
import { TechnicalAuditModule } from '../technical-audit/technical-audit.module.js';
import { AeoAuditReportCollector } from './collectors/aeo-audit.collector.js';
import { CompetitorsReportCollector } from './collectors/competitors.collector.js';
import { GapAnalysisReportCollector } from './collectors/gap-analysis.collector.js';
import { SocialActivityCollector } from './collectors/social-activity.collector.js';
import { TechnicalAuditCollector } from './collectors/technical-audit.collector.js';
import { ClientPortalReportController, PublicReportController, ReportController, ReportsController } from './controllers/reporting.controller.js';
import { ReportNarrativeService } from './services/report-narrative.service.js';
import { ReportRenderService } from './services/report-render.service.js';
import { ReportingService } from './services/reporting.service.js';

@Module({
  imports: [TechnicalAuditModule, SocialActivityModule, AeoAuditModule, CompetitorsModule, GapAnalysisModule, LlmModule],
  controllers: [ReportsController, ReportController, PublicReportController, ClientPortalReportController],
  providers: [
    TechnicalAuditCollector,
    SocialActivityCollector,
    AeoAuditReportCollector,
    CompetitorsReportCollector,
    GapAnalysisReportCollector,
    ReportNarrativeService,
    ReportRenderService,
    ReportingService,
  ],
  exports: [ReportingService],
})
export class ReportingModule {}
