import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PsiService } from './psi.service.js';

vi.mock('axios');

function lighthouseResponse(overrides: Record<string, unknown> = {}) {
  return {
    lighthouseResult: {
      audits: {
        'largest-contentful-paint': { numericValue: 2100.4 },
        'cumulative-layout-shift': { numericValue: 0.05123 },
        'interaction-to-next-paint': { numericValue: 150 },
        'unused-css': { score: 0.3, title: 'Remove unused CSS', description: 'See [here](https://x) for details.', displayValue: 'Save 50KB' },
        'passing-audit': { score: 1, title: 'Fine' },
        informational: { score: null, title: 'Informational only' },
      },
      categories: {
        performance: { score: 0.92, auditRefs: [{ id: 'unused-css' }, { id: 'passing-audit' }] },
        seo: { score: 1, auditRefs: [{ id: 'informational' }] },
        accessibility: { score: 0.8, auditRefs: [] },
        'best-practices': { score: 0.75, auditRefs: [] },
      },
      finalUrl: 'https://acme.com/',
      lighthouseVersion: '11.0.0',
    },
    loadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2200, category: 'FAST' } } },
    ...overrides,
  };
}

describe('PsiService', () => {
  afterEach(() => vi.resetAllMocks());

  async function build(apiKey: string | undefined) {
    const moduleRef = await Test.createTestingModule({
      providers: [PsiService, { provide: ConfigService, useValue: { get: () => apiKey } }],
    }).compile();
    return moduleRef.get(PsiService);
  }

  it('throws without an API key, never calling the API', async () => {
    const service = await build(undefined);
    await expect(service.fetchPsi('https://acme.com')).rejects.toThrow('PSI_API_KEY not configured');
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('requests all four categories explicitly, not just performance', async () => {
    vi.mocked(axios.get).mockResolvedValue({ status: 200, data: lighthouseResponse() });
    const service = await build('key');

    await service.fetchPsi('https://acme.com');

    const params = vi.mocked(axios.get).mock.calls[0]![1]!.params as { category: string[] };
    expect(params.category).toEqual(['performance', 'seo', 'accessibility', 'best-practices']);
  });

  it('extracts LCP/CLS/INP from numericValue, never from score', async () => {
    vi.mocked(axios.get).mockResolvedValue({ status: 200, data: lighthouseResponse() });
    const service = await build('key');

    const result = await service.fetchPsi('https://acme.com');

    expect(result.lcp).toBe(2100.4);
    expect(result.cls).toBe(0.051); // rounded to 3 decimals
    expect(result.inp).toBe(150);
  });

  it('returns -1 for a metric with no audit or no numericValue', async () => {
    const data = lighthouseResponse();
    delete (data.lighthouseResult.audits as Record<string, unknown>)['interaction-to-next-paint'];
    vi.mocked(axios.get).mockResolvedValue({ status: 200, data });
    const service = await build('key');

    const result = await service.fetchPsi('https://acme.com');

    expect(result.inp).toBe(-1);
  });

  it('flattens only genuinely failed audits, excluding informational (null score) and passing ones', async () => {
    vi.mocked(axios.get).mockResolvedValue({ status: 200, data: lighthouseResponse() });
    const service = await build('key');

    const result = await service.fetchPsi('https://acme.com');

    expect(result.failedAudits).toHaveLength(1);
    expect(result.failedAudits[0]!.id).toBe('unused-css');
    expect(result.failedAudits[0]!.description).toBe('See here for details.'); // markdown link stripped
  });

  it('returns null fieldData when there is no CrUX data, not an error', async () => {
    vi.mocked(axios.get).mockResolvedValue({ status: 200, data: lighthouseResponse({ loadingExperience: undefined }) });
    const service = await build('key');

    const result = await service.fetchPsi('https://acme.com');

    expect(result.fieldData).toBeNull();
  });

  it('throws with the API error message on a non-200 response', async () => {
    vi.mocked(axios.get).mockResolvedValue({ status: 400, data: { error: { message: 'invalid url' } } });
    const service = await build('key');

    await expect(service.fetchPsi('https://acme.com')).rejects.toThrow('invalid url');
  });

  it('throws when the response has no lighthouseResult at all', async () => {
    vi.mocked(axios.get).mockResolvedValue({ status: 200, data: {} });
    const service = await build('key');

    await expect(service.fetchPsi('https://acme.com')).rejects.toThrow('no lighthouse result');
  });
});
