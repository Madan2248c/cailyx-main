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
    }
  }
}
