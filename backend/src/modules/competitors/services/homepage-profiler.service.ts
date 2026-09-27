/**
 * One homepage fetch, four reads: tech stack, schema/JSON-LD types, SEO
 * score (Technical Audit's own rubric — the same function, not a
 * re-implementation), and any `AggregateRating` the page itself embeds.
 * Used for every competitor AND the project's own domain (the client's
 * own row uses the same code path — a fair, identical comparison).
 *
 * A blocked/timed-out/4xx/5xx fetch is a `FAILED` profile, not a crash —
 * same discipline as Technical Audit's own checks.
 *
 * @module competitors/services/homepage-profiler.service
 */

import { Injectable, Logger } from '@nestjs/common';
import { FetcherService } from '../../fetcher/fetcher.service.js';
import { extractPageSignals } from '../../technical-audit/services/checks/page-signals.js';
import { findPageIssues, scorePage } from '../../technical-audit/services/checks/seo-rubric.js';
import { HOMEPAGE_CACHE_TTL_SECONDS, HOMEPAGE_FETCH_TIMEOUT_MS } from '../competitors.constants.js';
import type { DomainProfile } from '../competitors.types.js';
import { detectTechStack } from './tech-stack-detector.js';
import { extractAggregateRating } from './review-rating.js';

@Injectable()
export class HomepageProfilerService {
  private readonly logger = new Logger(HomepageProfilerService.name);

  constructor(private readonly fetcher: FetcherService) {}

  async profile(domain: string): Promise<DomainProfile> {
    const host = normalizeHost(domain);
    const url = `https://${host}`;

    try {
      const res = await this.fetcher.fetch(
        { url, timeout: HOMEPAGE_FETCH_TIMEOUT_MS, cacheTtlSeconds: HOMEPAGE_CACHE_TTL_SECONDS },
        'competitors-homepage-profile',
      );

      if (res.status === 0 || res.status >= 400) {
        return emptyProfile('FAILED', `Fetch failed: HTTP ${res.status} ${res.statusText}`.trim());
      }

      const techStackFindings = detectTechStack(res.headers, res.body);
      const signals = extractPageSignals(res.body, res.status, url, host);
      const issues = findPageIssues(signals, url, host);
      const seoScore = scorePage(issues);
      const reviewRating = extractAggregateRating(res.body, host);

      return {
        techStackFindings,
        schemaTypes: signals.jsonLdTypes,
        seoScore,
        seoIssues: issues,
        reviewRating,
        fetchStatus: 'OK',
        error: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Homepage profile fetch failed for ${host}: ${message}`);
      return emptyProfile('FAILED', message);
    }
  }
}

function emptyProfile(fetchStatus: 'FAILED', error: string): DomainProfile {
  return { techStackFindings: [], schemaTypes: [], seoScore: null, seoIssues: [], reviewRating: null, fetchStatus, error };
}

function normalizeHost(domain: string): string {
  return domain
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]!
    .trim();
}
