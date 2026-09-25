/**
 * Technical Audit module — Stage 2 of the Day-1 pipeline.
 *
 * Given a project, crawls its site and runs eight technical/SEO checks
 * (robots.txt, CDN/bot-block probing, JS-render dependency, Core Web Vitals
 * via PSI, schema.org, sitemap, agent-readiness, per-page inventory), rolls
 * them into one 0-100 composite, diffs the run against the project's
 * previous audit, and writes an LLM narrative. See
 * docs/analysis/technical-audit.md for the design and `README.md` next to
 * this file for the operational notes.
 *
 * One BullMQ queue (`technical-audit`, concurrency 1) carries both manual
 * runs (one job per `technical_audit_runs` row) and recurring schedules (one
 * job scheduler per project — the worker creates the run at fire time).
 * Shares the same Redis instance the fetcher module's cache/rate-limiter
 * use — one Redis config, two independent consumers of it.
 */

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { FetcherModule } from '../fetcher/fetcher.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { TechnicalAuditController, TechnicalAuditRunController } from './controllers/technical-audit.controller.js';
import { TECHNICAL_AUDIT_QUEUE } from './queue/technical-audit.queue.js';
import { TechnicalAuditProcessor } from './queue/technical-audit.processor.js';
import { TechnicalAuditScheduler } from './services/technical-audit.scheduler.js';
import { TechnicalAuditService } from './services/technical-audit.service.js';
import { AgentReadinessCheck } from './services/checks/agent-readiness.check.js';
import { CdnCheck } from './services/checks/cdn.check.js';
import { CwvCheck } from './services/checks/cwv.check.js';
import { JsRenderCheck } from './services/checks/js-render.check.js';
import { PageInventoryCheck } from './services/checks/page-inventory.check.js';
import { RobotsCheck } from './services/checks/robots.check.js';
import { SchemaCheck } from './services/checks/schema.check.js';
import { SitemapCheck } from './services/checks/sitemap.check.js';
import { NarrativeService } from './services/narrative.service.js';
import { PageMetadataService } from './services/page-metadata.service.js';
import { PsiService } from './services/psi.service.js';

@Module({
  imports: [FetcherModule, LlmModule, BullModule.registerQueue({ name: TECHNICAL_AUDIT_QUEUE })],
  controllers: [TechnicalAuditController, TechnicalAuditRunController],
  providers: [
    // The queue consumer, the schedule manager, and the orchestrator that
    // does the real work.
    TechnicalAuditProcessor,
    TechnicalAuditScheduler,
    TechnicalAuditService,

    // The eight checks, in pipeline order. None touches Prisma directly
    // (page-inventory takes it as a method argument for the optional
    // discovered-page reuse read) — the orchestrator persists everything.
    RobotsCheck,
    CdnCheck,
    SitemapCheck,
    JsRenderCheck,
    PsiService,
    CwvCheck,
    SchemaCheck,
    AgentReadinessCheck,
    PageInventoryCheck,

    // Best-effort extras around the checks, never fatal to the run.
    PageMetadataService,
    NarrativeService,
  ],
  exports: [TechnicalAuditService],
})
export class TechnicalAuditModule {}
