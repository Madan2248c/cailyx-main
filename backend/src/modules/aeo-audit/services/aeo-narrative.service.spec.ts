import { describe, expect, it, vi } from 'vitest';
import { LlmService } from '../../llm/llm.service.js';
import { AeoNarrativeService } from './aeo-narrative.service.js';

describe('AeoNarrativeService', () => {
  it('returns the validated headlines with prior-period context passed through', async () => {
    const llm = {
      json: vi.fn((req: { user: string }, validate: (raw: unknown) => unknown) => {
        expect(req.user).toContain('Prior-period headlines');
        return Promise.resolve({ data: validate({ headlines: ['New headline'] }), model: 'm', costUsd: 0.001 });
      }),
    } as unknown as LlmService;
    const service = new AeoNarrativeService(llm);
    const result = await service.write({ headlines: ['A'], priorHeadlines: ['Old headline'] });
    expect(result.headlines).toEqual(['New headline']);
  });

  it('throws rather than returning an empty narrative', async () => {
    const llm = { json: vi.fn((_req, validate: (raw: unknown) => unknown) => Promise.resolve({ data: validate({ headlines: [] }), model: 'm', costUsd: 0 })) } as unknown as LlmService;
    const service = new AeoNarrativeService(llm);
    await expect(service.write({ headlines: ['A'] })).rejects.toThrow(/no headlines/);
  });

  it('caps headline count and length', async () => {
    const longLines = Array.from({ length: 20 }, (_, i) => `line ${i} `.repeat(50));
    const llm = { json: vi.fn((_req, validate: (raw: unknown) => unknown) => Promise.resolve({ data: validate({ headlines: longLines }), model: 'm', costUsd: 0 })) } as unknown as LlmService;
    const service = new AeoNarrativeService(llm);
    const result = await service.write({ headlines: ['A'] });
    expect(result.headlines.length).toBeLessThanOrEqual(8);
    expect(result.headlines.every((h) => h.length <= 220)).toBe(true);
  });
});
