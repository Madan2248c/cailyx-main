/**
 * Competitors module — profiles the project's tracked competitors (tech
 * stack, schema, homepage SEO score on the shared rubric, review rating)
 * plus the project's own domain, and produces a deterministic gap
 * comparison. Reuses AEO Audit's existing `Competitor` table (never a
 * second competitor list) and Discovery's `DataForSeoSerpService` for the
 * one new discovery path (`serp_discovered`). See `README.md`.
 */

import { Module } from '@nestjs/common';
import { AeoAuditModule } from '../aeo-audit/aeo-audit.module.js';
import { DiscoveryModule } from '../discovery/discovery.module.js';
import { FetcherModule } from '../fetcher/fetcher.module.js';
import { CompetitorsController } from './controllers/competitors.controller.js';
import { CompetitorsService } from './services/competitors.service.js';
import { HomepageProfilerService } from './services/homepage-profiler.service.js';
import { SerpDiscoveryService } from './services/serp-discovery.service.js';

@Module({
  imports: [FetcherModule, DiscoveryModule, AeoAuditModule],
  controllers: [CompetitorsController],
  providers: [SerpDiscoveryService, HomepageProfilerService, CompetitorsService],
  exports: [CompetitorsService],
})
export class CompetitorsModule {}
