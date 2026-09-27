/**
 * Deterministic offline surface adapter — test-only, gated behind
 * `MEASUREMENT_ALLOW_MOCK=1`. Never used in a real run.
 *
 * @module measurement/adapters/mock.adapter
 */

import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SurfaceAdapter, SurfaceAnswer } from '../measurement.types.js';

@Injectable()
export class MockSurfaceAdapter implements SurfaceAdapter {
  readonly name = 'mock' as const;

  constructor(private readonly config: ConfigService) {}

  async runPrompt(prompt: string): Promise<SurfaceAnswer> {
    if (this.config.get<string>('MEASUREMENT_ALLOW_MOCK') !== '1') {
      throw new ServiceUnavailableException('The mock surface is disabled — set MEASUREMENT_ALLOW_MOCK=1 to enable it (test-only, never in prod).');
    }
    return {
      text: `Mock answer for: ${prompt}`,
      citations: [],
      costUsd: 0,
      latencyMs: 1,
      model: 'mock',
    };
  }
}
