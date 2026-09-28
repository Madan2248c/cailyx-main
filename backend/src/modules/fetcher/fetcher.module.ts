/**
 * Fetcher Module — The single source of all outbound network requests in Cailyx.
 *
 * Exports FetcherService which other modules inject to:
 *   - fetch URLs with custom User-Agents
 *   - probe sites for AI crawler access
 *   - render pages with headless browser
 *   - extract JSON-LD schema
 *   - verify URLs (sameAs check)
 *
 * PageSpeed Insights is intentionally not part of this module — see
 * docs/analysis/discovery.md.
 *
 * @module fetcher.module
 */

import { Module } from '@nestjs/common';
import { FetcherService } from './fetcher.service.js';
import { HttpClientService } from './clients/http-client.service.js';
import { BrowserClientService } from './clients/browser-client.service.js';
import { CacheService } from './services/cache.service.js';
import { RateLimiterService } from './services/rate-limiter.service.js';
import { RetryService } from './services/retry.service.js';
import { CostTrackerService } from './services/cost-tracker.service.js';
import { RobotsService } from './services/robots.service.js';

@Module({
  providers: [
    FetcherService,
    HttpClientService,
    BrowserClientService,
    CacheService,
    RateLimiterService,
    RetryService,
    CostTrackerService,
    RobotsService,
  ],
  // RobotsService is exported alongside FetcherService (not folded into it)
  // so a crawler can consult "is this URL allowed" independently of making
  // the fetch. BrowserClientService is exported for printing documents
  // (the Fix Plan overview PDF) on the same shared Chromium instance.
  exports: [FetcherService, RobotsService, BrowserClientService],
})
export class FetcherModule {}
