/**
 * Gap Analysis module (SOP-5) — the first and only place a recommendation
 * gets generated in this pipeline. Reads the latest completed run from
 * Technical Audit, AEO Audit, and Social Activity via their own exported
 * services (no cross-module DB reads), consolidates every finding into
 * one ranked list of concrete next steps via a single LLM call, validated
 * by code-enforced guardrails. See `README.md` for the design as-built.
 */

import { Module } from '@nestjs/common';
import { AeoAuditModule } from '../aeo-audit/aeo-audit.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { SocialActivityModule } from '../social-activity/social-activity.module.js';
import { TechnicalAuditModule } from '../technical-audit/technical-audit.module.js';
import { AeoAuditCollector } from './collectors/aeo-audit.collector.js';
import { SocialActivityCollector } from './collectors/social-activity.collector.js';
import { TechnicalAuditCollector } from './collectors/technical-audit.collector.js';
import { GapAnalysisController, GapAnalysisRecommendationController, GapAnalysisRunController } from './controllers/gap-analysis.controller.js';
import { GapAnalysisGenerationService } from './services/gap-analysis-generation.service.js';
import { GapAnalysisService } from './services/gap-analysis.service.js';

@Module({
  imports: [TechnicalAuditModule, SocialActivityModule, AeoAuditModule, LlmModule],
  controllers: [GapAnalysisController, GapAnalysisRunController, GapAnalysisRecommendationController],
  providers: [TechnicalAuditCollector, SocialActivityCollector, AeoAuditCollector, GapAnalysisGenerationService, GapAnalysisService],
  exports: [GapAnalysisService],
})
export class GapAnalysisModule {}
