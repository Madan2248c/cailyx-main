/**
 * Remediation ("Fix Plan") module — turns audit findings into tracked fix
 * specs: evidence, a generated fix where one can be computed, numbered
 * steps, and a machine-checkable acceptance check; then proves fixes on the
 * live site. Reads every source through that module's own exported service.
 * See docs/analysis/remediation.md and `README.md`.
 */

import { Module } from '@nestjs/common';
import { AeoAuditModule } from '../aeo-audit/aeo-audit.module.js';
import { DiscoveryModule } from '../discovery/discovery.module.js';
import { FetcherModule } from '../fetcher/fetcher.module.js';
import { GapAnalysisModule } from '../gap-analysis/gap-analysis.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { SocialActivityModule } from '../social-activity/social-activity.module.js';
import { TechnicalAuditModule } from '../technical-audit/technical-audit.module.js';
import { SourceSnapshotCollector } from './collectors/source-snapshot.collector.js';
import { RemediationController, RemediationFixController, RemediationRunController } from './controllers/remediation.controller.js';
import { RemediationDraftService } from './services/remediation-draft.service.js';
import { RemediationSyncService } from './services/remediation-sync.service.js';
import { RemediationService } from './services/remediation.service.js';
import { LiveVerifier } from './verifiers/live.verifier.js';

@Module({
  imports: [TechnicalAuditModule, SocialActivityModule, AeoAuditModule, DiscoveryModule, GapAnalysisModule, FetcherModule, LlmModule],
  controllers: [RemediationController, RemediationRunController, RemediationFixController],
  providers: [SourceSnapshotCollector, LiveVerifier, RemediationSyncService, RemediationService, RemediationDraftService],
  exports: [RemediationService, RemediationSyncService],
})
export class RemediationModule {}
