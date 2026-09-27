/**
 * Deterministic offline DataForSEO adapter — the ONLY adapter wired into
 * this build. Gated behind `DATAFORSEO_ALLOW_MOCK=1` (same pattern as
 * measurement's `MockSurfaceAdapter` behind `MEASUREMENT_ALLOW_MOCK`).
 * Never touches the network, never reads DATAFORSEO_LOGIN/PASSWORD, never
 * spends a credit.
 *
 * Fixture shapes mirror the live API's normalized rows so the service,
 * snapshots, and any future live adapter agree on the payload contract:
 * - serp-ranks: keyword/url/position/prev/volume rows
 * - backlinks-summary: referring-domains/new/lost counts
 * - keyword-overview: keyword volume/difficulty/cpc rows
 * - backlink-rows: source/target/anchor/dofollow/spam/first/last/lost rows
 * - referring-domains: domain/backlinks/firstSeen rows (top 10)
 * - top-pages: url/backlinks/refDomains rows (top 10)
 * - keyword-ideas: keyword volume/difficulty/cpc rows
 * - serp-snapshot: keyword + top-10 position/url/title/features results
 * - domain-overview: rank/rankedKeywords/trafficEstimate/refDomains
 *
 * Live mapping (for the later live-wiring pass — no live calls here):
 * - serp-ranks <- SERP API (`serp/google/organic/live/advanced`)
 * - backlinks-summary / backlink-rows <- Backlinks API (`backlinks/backlinks/live`)
 * - referring-domains <- Backlinks API (`backlinks/referring_domains/live`)
 * - top-pages <- Backlinks API (`backlinks/pages/live`)
 * - keyword-overview / keyword-ideas <- Keywords Data API
 *   (`keywords_data/google/search_volume/live`, `dataforseo_labs/google/keyword_ideas/live`)
 * - serp-snapshot <- SERP API (`serp/google/organic/live/advanced`)
 * - domain-overview <- DataForSEO Labs API (`dataforseo_labs/google/overview/live`)
 *
 * @module dataforseo/adapters/mock.adapter
 */

import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MOCK_COST_PER_DATASET_USD } from '../dataforseo.constants.js';
import type { DataforseoAdapter, DataforseoDataset, DatasetResult } from '../dataforseo.types.js';

@Injectable()
export class MockDataforseoAdapter implements DataforseoAdapter {
  readonly name = 'mock' as const;

  constructor(private readonly config: ConfigService) {}

  private assertEnabled(): void {
    if (this.config.get<string>('DATAFORSEO_ALLOW_MOCK') !== '1') {
      throw new ServiceUnavailableException(
        'The DataForSEO mock adapter is disabled — set DATAFORSEO_ALLOW_MOCK=1 to enable it (test-only; live DataForSEO is not wired in this build).',
      );
    }
  }

  async fetchDataset(dataset: DataforseoDataset, domain: string): Promise<DatasetResult> {
    this.assertEnabled();
    const clean = domain
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]!;
    switch (dataset) {
      case 'serp-ranks':
        return {
          payload: {
            dataset: 'serp-ranks',
            rankings: [
              { keyword: `best ${clean} alternative`, url: `https://${clean}/pricing`, position: 4, prevPosition: 6, volume: 1300 },
              { keyword: `${clean} pricing`, url: `https://${clean}/pricing`, position: 2, prevPosition: 2, volume: 880 },
              { keyword: `${clean} reviews`, url: `https://${clean}/`, position: 9, prevPosition: null, volume: 450 },
            ],
          },
          costUsd: MOCK_COST_PER_DATASET_USD,
        };
      case 'backlinks-summary':
        return {
          payload: {
            dataset: 'backlinks-summary',
            referringDomains: 214,
            newBacklinks: 18,
            lostBacklinks: 5,
          },
          costUsd: MOCK_COST_PER_DATASET_USD,
        };
      case 'keyword-overview':
        return {
          payload: {
            dataset: 'keyword-overview',
            keywords: [
              { keyword: `best ${clean} alternative`, volume: 1300, difficulty: 42, cpc: 3.8 },
              { keyword: `${clean} pricing`, volume: 880, difficulty: 28, cpc: 2.1 },
              { keyword: `${clean} reviews`, volume: 450, difficulty: 35, cpc: 1.4 },
            ],
          },
          costUsd: MOCK_COST_PER_DATASET_USD,
        };
      case 'backlink-rows':
        return {
          payload: {
            dataset: 'backlink-rows',
            backlinks: [
              { sourceUrl: 'https://blog.example.org/best-tools-roundup', targetUrl: `https://${clean}/pricing`, anchor: `${clean} pricing`, isDofollow: true, spamScore: 2, firstSeen: '2025-11-04', lastSeen: '2026-09-20', lost: false },
              { sourceUrl: 'https://news.example.net/startup-directory', targetUrl: `https://${clean}/`, anchor: clean, isDofollow: true, spamScore: 5, firstSeen: '2025-08-12', lastSeen: '2026-09-18', lost: false },
              { sourceUrl: 'https://reviews.example.com/widget-showdown', targetUrl: `https://${clean}/blog/vs-competitor`, anchor: 'in-depth comparison', isDofollow: true, spamScore: 8, firstSeen: '2026-01-22', lastSeen: '2026-09-15', lost: false },
              { sourceUrl: 'https://forum.example.io/t/recommended-stacks', targetUrl: `https://${clean}/docs`, anchor: 'docs', isDofollow: false, spamScore: 12, firstSeen: '2026-02-03', lastSeen: '2026-09-10', lost: false },
              { sourceUrl: 'https://partners.example.dev/integrations', targetUrl: `https://${clean}/integrations`, anchor: 'integration guide', isDofollow: true, spamScore: 1, firstSeen: '2025-12-19', lastSeen: '2026-09-08', lost: false },
              { sourceUrl: 'https://blog.example.org/pricing-breakdown-2026', targetUrl: `https://${clean}/pricing`, anchor: 'see plans', isDofollow: false, spamScore: 3, firstSeen: '2026-03-30', lastSeen: '2026-09-05', lost: false },
              { sourceUrl: 'https://directory.example.net/saas-listings', targetUrl: `https://${clean}/`, anchor: `${clean} homepage`, isDofollow: true, spamScore: 22, firstSeen: '2025-06-15', lastSeen: '2026-08-28', lost: true },
              { sourceUrl: 'https://newsletter.example.com/issue-142', targetUrl: `https://${clean}/blog/launch-notes`, anchor: 'launch notes', isDofollow: true, spamScore: 4, firstSeen: '2026-04-11', lastSeen: '2026-09-12', lost: false },
              { sourceUrl: 'https://agency.example.co/case-studies', targetUrl: `https://${clean}/customers`, anchor: 'customer stories', isDofollow: true, spamScore: 6, firstSeen: '2026-05-02', lastSeen: '2026-09-14', lost: false },
              { sourceUrl: 'https://spammy.example.xyz/free-links', targetUrl: `https://${clean}/`, anchor: 'click here', isDofollow: false, spamScore: 87, firstSeen: '2026-06-20', lastSeen: '2026-07-30', lost: true },
              { sourceUrl: 'https://docs.example.dev/awesome-list', targetUrl: `https://${clean}/docs`, anchor: 'official docs', isDofollow: true, spamScore: 0, firstSeen: '2025-10-01', lastSeen: '2026-09-19', lost: false },
              { sourceUrl: 'https://podcast.example.fm/episode-88-notes', targetUrl: `https://${clean}/blog/vs-competitor`, anchor: 'comparison post', isDofollow: false, spamScore: null, firstSeen: null, lastSeen: '2026-09-11', lost: false },
            ],
          },
          costUsd: MOCK_COST_PER_DATASET_USD,
        };
      case 'referring-domains':
        return {
          payload: {
            dataset: 'referring-domains',
            domains: [
              { domain: 'blog.example.org', backlinks: 34, firstSeen: '2025-08-02' },
              { domain: 'news.example.net', backlinks: 27, firstSeen: '2025-06-19' },
              { domain: 'reviews.example.com', backlinks: 21, firstSeen: '2025-11-30' },
              { domain: 'forum.example.io', backlinks: 18, firstSeen: '2026-01-14' },
              { domain: 'partners.example.dev', backlinks: 15, firstSeen: '2025-12-05' },
              { domain: 'directory.example.net', backlinks: 12, firstSeen: '2025-05-27' },
              { domain: 'newsletter.example.com', backlinks: 9, firstSeen: '2026-03-08' },
              { domain: 'agency.example.co', backlinks: 7, firstSeen: '2026-02-16' },
              { domain: 'docs.example.dev', backlinks: 5, firstSeen: '2025-10-11' },
              { domain: 'podcast.example.fm', backlinks: 3, firstSeen: '2026-06-01' },
            ],
          },
          costUsd: MOCK_COST_PER_DATASET_USD,
        };
      case 'top-pages':
        return {
          payload: {
            dataset: 'top-pages',
            pages: [
              { url: `https://${clean}/pricing`, backlinks: 58, refDomains: 41 },
              { url: `https://${clean}/`, backlinks: 47, refDomains: 35 },
              { url: `https://${clean}/blog/vs-competitor`, backlinks: 33, refDomains: 26 },
              { url: `https://${clean}/docs`, backlinks: 25, refDomains: 19 },
              { url: `https://${clean}/blog/launch-notes`, backlinks: 18, refDomains: 14 },
              { url: `https://${clean}/integrations`, backlinks: 14, refDomains: 11 },
              { url: `https://${clean}/customers`, backlinks: 11, refDomains: 9 },
              { url: `https://${clean}/blog/pricing-guide`, backlinks: 8, refDomains: 7 },
              { url: `https://${clean}/features`, backlinks: 6, refDomains: 5 },
              { url: `https://${clean}/about`, backlinks: 4, refDomains: 4 },
            ],
          },
          costUsd: MOCK_COST_PER_DATASET_USD,
        };
      case 'keyword-ideas':
        return {
          payload: {
            dataset: 'keyword-ideas',
            keywords: [
              { keyword: `best ${clean} alternative`, volume: 1300, difficulty: 42, cpc: 3.8 },
              { keyword: `${clean} pricing`, volume: 880, difficulty: 28, cpc: 2.1 },
              { keyword: `${clean} reviews`, volume: 450, difficulty: 35, cpc: 1.4 },
              { keyword: `${clean} vs competitor`, volume: 720, difficulty: 51, cpc: 4.6 },
              { keyword: `${clean} integrations`, volume: 590, difficulty: 33, cpc: 2.9 },
              { keyword: `${clean} tutorial`, volume: 480, difficulty: 22, cpc: 1.1 },
              { keyword: `${clean} free trial`, volume: 390, difficulty: 31, cpc: 5.2 },
              { keyword: `${clean} demo`, volume: 320, difficulty: 26, cpc: 4.1 },
              { keyword: `${clean} api docs`, volume: 280, difficulty: 18, cpc: 0.9 },
              { keyword: `${clean} changelog`, volume: 210, difficulty: 12, cpc: 0.4 },
              { keyword: `${clean} templates`, volume: 540, difficulty: 37, cpc: 1.8 },
              { keyword: `${clean} for agencies`, volume: 260, difficulty: 44, cpc: 3.3 },
              { keyword: `${clean} discount code`, volume: 190, difficulty: 15, cpc: 2.7 },
              { keyword: `${clean} onboarding`, volume: 170, difficulty: 20, cpc: 1.6 },
              { keyword: `${clean} security`, volume: 150, difficulty: 47, cpc: 3.1 },
              { keyword: `${clean} alternatives free`, volume: 410, difficulty: 39, cpc: 2.4 },
            ],
          },
          costUsd: MOCK_COST_PER_DATASET_USD,
        };
      case 'serp-snapshot':
        return {
          payload: {
            dataset: 'serp-snapshot',
            keyword: `best ${clean} alternative`,
            results: [
              { position: 1, url: 'https://rival.example.com/', title: 'Rival — the popular alternative', features: ['featured_snippet'] },
              { position: 2, url: 'https://reviews.example.com/widget-showdown', title: 'Widget showdown: 8 tools compared', features: ['review_stars'] },
              { position: 3, url: 'https://blog.example.org/best-tools-roundup', title: 'Best tools roundup 2026', features: [] },
              { position: 4, url: `https://${clean}/pricing`, title: `${clean} — pricing`, features: ['sitelinks'] },
              { position: 5, url: 'https://news.example.net/startup-directory', title: 'Startup directory: top picks', features: [] },
              { position: 6, url: 'https://forum.example.io/t/recommended-stacks', title: 'Recommended stacks thread', features: ['discussions'] },
              { position: 7, url: 'https://agency.example.co/case-studies', title: 'Case studies: switching stacks', features: [] },
              { position: 8, url: `https://${clean}/blog/vs-competitor`, title: `${clean} vs the competition`, features: [] },
              { position: 9, url: 'https://directory.example.net/saas-listings', title: 'SaaS listings A–Z', features: [] },
              { position: 10, url: 'https://podcast.example.fm/episode-88-notes', title: 'Episode 88 show notes', features: ['video'] },
            ],
          },
          costUsd: MOCK_COST_PER_DATASET_USD,
        };
      case 'domain-overview':
        return {
          payload: {
            dataset: 'domain-overview',
            rank: 48210,
            rankedKeywords: 1874,
            trafficEstimate: 23150,
            refDomains: 214,
          },
          costUsd: MOCK_COST_PER_DATASET_USD,
        };
    }
  }
}
