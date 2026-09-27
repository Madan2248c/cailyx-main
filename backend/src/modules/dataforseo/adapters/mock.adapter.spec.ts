import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { MockDataforseoAdapter } from './mock.adapter.js';

/**
 * The mock gate (mirrors measurement's MockSurfaceAdapter): disabled by
 * default, never touches the network or credentials when enabled.
 */
describe('MockDataforseoAdapter', () => {
  let adapter: MockDataforseoAdapter;
  let config: { get: ReturnType<typeof vi.fn> };

  async function build(allowMock?: string) {
    config = { get: vi.fn((key: string) => (key === 'DATAFORSEO_ALLOW_MOCK' ? allowMock : undefined)) };
    const moduleRef = await Test.createTestingModule({
      providers: [MockDataforseoAdapter, { provide: ConfigService, useValue: config }],
    }).compile();
    adapter = moduleRef.get(MockDataforseoAdapter);
  }

  it('is disabled unless DATAFORSEO_ALLOW_MOCK=1 — nothing fetched, nothing spent', async () => {
    await build(undefined);
    await expect(adapter.fetchDataset('serp-ranks', 'example.com')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await build('0');
    await expect(adapter.fetchDataset('backlinks-summary', 'example.com')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('serp-ranks rows carry keyword/url/position/prev/volume', async () => {
    await build('1');
    const result = await adapter.fetchDataset('serp-ranks', 'https://www.example.com/pricing');
    expect(result.costUsd).toBeGreaterThanOrEqual(0);
    expect(result.payload.dataset).toBe('serp-ranks');
    const rows = result.payload.dataset === 'serp-ranks' ? result.payload.rankings : [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(typeof row.keyword).toBe('string');
      expect(typeof row.url).toBe('string');
      expect(typeof row.position).toBe('number');
      expect(row.prevPosition === null || typeof row.prevPosition === 'number').toBe(true);
      expect(typeof row.volume).toBe('number');
    }
  });

  it('backlinks-summary carries referring domains + new/lost counts', async () => {
    await build('1');
    const result = await adapter.fetchDataset('backlinks-summary', 'example.com');
    expect(result.payload.dataset).toBe('backlinks-summary');
    if (result.payload.dataset === 'backlinks-summary') {
      expect(typeof result.payload.referringDomains).toBe('number');
      expect(typeof result.payload.newBacklinks).toBe('number');
      expect(typeof result.payload.lostBacklinks).toBe('number');
    }
  });

  it('keyword-overview rows carry volume/difficulty/cpc', async () => {
    await build('1');
    const result = await adapter.fetchDataset('keyword-overview', 'example.com');
    expect(result.payload.dataset).toBe('keyword-overview');
    const rows = result.payload.dataset === 'keyword-overview' ? result.payload.keywords : [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(typeof row.keyword).toBe('string');
      expect(typeof row.volume).toBe('number');
      expect(typeof row.difficulty).toBe('number');
      expect(typeof row.cpc).toBe('number');
    }
  });
});
