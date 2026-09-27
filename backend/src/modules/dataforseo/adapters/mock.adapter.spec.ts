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

  it('backlink-rows carry 10-20 source/target/anchor/dofollow/spam/seen/lost rows', async () => {
    await build('1');
    const result = await adapter.fetchDataset('backlink-rows', 'example.com');
    expect(result.costUsd).toBeGreaterThanOrEqual(0);
    expect(result.payload.dataset).toBe('backlink-rows');
    const rows = result.payload.dataset === 'backlink-rows' ? result.payload.backlinks : [];
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows.length).toBeLessThanOrEqual(20);
    for (const row of rows) {
      expect(typeof row.sourceUrl).toBe('string');
      expect(typeof row.targetUrl).toBe('string');
      expect(typeof row.anchor).toBe('string');
      expect(typeof row.isDofollow).toBe('boolean');
      expect(row.spamScore === null || typeof row.spamScore === 'number').toBe(true);
      expect(row.firstSeen === null || typeof row.firstSeen === 'string').toBe(true);
      expect(row.lastSeen === null || typeof row.lastSeen === 'string').toBe(true);
      expect(typeof row.lost).toBe('boolean');
    }
  });

  it('referring-domains carries the top 10 domain/backlinks/firstSeen rows', async () => {
    await build('1');
    const result = await adapter.fetchDataset('referring-domains', 'example.com');
    expect(result.payload.dataset).toBe('referring-domains');
    const rows = result.payload.dataset === 'referring-domains' ? result.payload.domains : [];
    expect(rows).toHaveLength(10);
    for (const row of rows) {
      expect(typeof row.domain).toBe('string');
      expect(typeof row.backlinks).toBe('number');
      expect(row.firstSeen === null || typeof row.firstSeen === 'string').toBe(true);
    }
  });

  it('top-pages carries the top 10 url/backlinks/refDomains rows', async () => {
    await build('1');
    const result = await adapter.fetchDataset('top-pages', 'example.com');
    expect(result.payload.dataset).toBe('top-pages');
    const rows = result.payload.dataset === 'top-pages' ? result.payload.pages : [];
    expect(rows).toHaveLength(10);
    for (const row of rows) {
      expect(typeof row.url).toBe('string');
      expect(typeof row.backlinks).toBe('number');
      expect(typeof row.refDomains).toBe('number');
    }
  });

  it('keyword-ideas carry 15-20 keyword/volume/difficulty/cpc rows', async () => {
    await build('1');
    const result = await adapter.fetchDataset('keyword-ideas', 'example.com');
    expect(result.payload.dataset).toBe('keyword-ideas');
    const rows = result.payload.dataset === 'keyword-ideas' ? result.payload.keywords : [];
    expect(rows.length).toBeGreaterThanOrEqual(15);
    expect(rows.length).toBeLessThanOrEqual(20);
    for (const row of rows) {
      expect(typeof row.keyword).toBe('string');
      expect(typeof row.volume).toBe('number');
      expect(typeof row.difficulty).toBe('number');
      expect(typeof row.cpc).toBe('number');
    }
  });

  it('serp-snapshot carries one keyword + top 10 position/url/title/features results', async () => {
    await build('1');
    const result = await adapter.fetchDataset('serp-snapshot', 'example.com');
    expect(result.payload.dataset).toBe('serp-snapshot');
    if (result.payload.dataset === 'serp-snapshot') {
      expect(typeof result.payload.keyword).toBe('string');
      expect(result.payload.results).toHaveLength(10);
      for (const row of result.payload.results) {
        expect(typeof row.position).toBe('number');
        expect(typeof row.url).toBe('string');
        expect(typeof row.title).toBe('string');
        expect(Array.isArray(row.features)).toBe(true);
      }
    }
  });

  it('domain-overview carries rank/rankedKeywords/trafficEstimate/refDomains', async () => {
    await build('1');
    const result = await adapter.fetchDataset('domain-overview', 'example.com');
    expect(result.payload.dataset).toBe('domain-overview');
    if (result.payload.dataset === 'domain-overview') {
      expect(typeof result.payload.rank).toBe('number');
      expect(typeof result.payload.rankedKeywords).toBe('number');
      expect(typeof result.payload.trafficEstimate).toBe('number');
      expect(typeof result.payload.refDomains).toBe('number');
    }
  });
});
