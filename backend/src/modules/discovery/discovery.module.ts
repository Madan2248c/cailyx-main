/**
 * Discovery / company-context module — Stage 1 of the Day-1 pipeline.
 *
 * Given a project, crawls its site and produces an evidence-backed company
 * context profile. See docs/analysis/discovery.md for the design and
 * `README.md` next to this file for the operational notes.
 *
 * Two Redis consumers live in this module and are deliberately independent:
 * BullMQ's queue state (registered here) and the ported fetcher's cache and
 * rate-limiter (registered in `FetcherModule`). Same Redis instance, unrelated
 * state — see the design doc's "Job orchestration".
 */

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { FetcherModule } from '../fetcher/fetcher.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { DiscoveryController, DiscoveryRunController } from './controllers/discovery.controller.js';
import { DISCOVERY_QUEUE } from './queue/discovery.queue.js';
import { DiscoveryProcessor } from './queue/discovery.processor.js';
import { BoundedSearchService } from './services/bounded-search.service.js';
import { DataForSeoSerpService } from './services/dataforseo-serp.service.js';
import { DiscoveryService } from './services/discovery.service.js';
import { PresenceDiscoveryService } from './services/presence-discovery.service.js';
import { PresenceSerpService } from './services/presence-serp.service.js';
import { SocialVerificationService } from './services/social-verification.service.js';
import { CompileStage } from './services/stages/compile.stage.js';
import { ConsolidateStage } from './services/stages/consolidate.stage.js';
import { DiscoverStage } from './services/stages/discover.stage.js';
import { ExternalEnrichStage } from './services/stages/external-enrich.stage.js';
import { ExtractStage } from './services/stages/extract.stage.js';
import { GapResearchStage } from './services/stages/gap-research.stage.js';
import { InspectStage } from './services/stages/inspect.stage.js';
import { ReconcileStage } from './services/stages/reconcile.stage.js';
import { SelectStage } from './services/stages/select.stage.js';
import { SocialDiscoveryStage } from './services/stages/social-discovery.stage.js';
import { SynthesizeStage } from './services/stages/synthesize.stage.js';
import { ValidateStage } from './services/stages/validate.stage.js';
import { VerifyStage } from './services/stages/verify.stage.js';

@Module({
  imports: [FetcherModule, LlmModule, BullModule.registerQueue({ name: DISCOVERY_QUEUE })],
  controllers: [DiscoveryController, DiscoveryRunController],
  providers: [
    // The queue consumer and the orchestrator that does the real work.
    DiscoveryProcessor,
    DiscoveryService,

    // The one SERP client (paid search is deliberately singular in this
    // codebase — the old repo consolidated two vendors down to it). The LLM
    // client every extraction/consolidation/verification stage uses now
    // comes from LlmModule — Technical Audit needs the same client.
    DataForSeoSerpService,

    // Social footprint: same-site discovery, the SERP fallback sweep, and our
    // own point-table scoring pass.
    PresenceDiscoveryService,
    PresenceSerpService,
    SocialVerificationService,

    // The bounded-search engine shared by the external-enrichment and
    // gap-research stages (one implementation, two callers).
    BoundedSearchService,

    // The thirteen pipeline stages, in pipeline order.
    DiscoverStage,
    InspectStage,
    SelectStage,
    ExtractStage,
    ReconcileStage,
    ValidateStage,
    SocialDiscoveryStage,
    ExternalEnrichStage,
    ConsolidateStage,
    GapResearchStage,
    SynthesizeStage,
    VerifyStage,
    CompileStage,
  ],
  // ProjectsService starts a run when a project is created, so the orchestrator
  // is the module's public surface. The stages stay private — nothing outside
  // this module should be able to run one stage in isolation.
  // DataForSeoSerpService is also exported: the Competitors module's SERP
  // discovery reuses this exact client rather than a second DataForSEO
  // integration — same credentials, same cache, same SWARM_ALLOW_LIVE gate.
  exports: [DiscoveryService, DataForSeoSerpService],
})
export class DiscoveryModule {}
