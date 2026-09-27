import { describe, expect, it, vi } from 'vitest';
import { LlmService } from '../../llm/llm.service.js';
import { AeoStanceService } from './aeo-stance.service.js';

describe('AeoStanceService', () => {
  function makeService(jsonImpl: (req: unknown, validate: (raw: unknown) => unknown) => unknown) {
    const llm = { json: vi.fn(jsonImpl) } as unknown as LlmService;
    return new AeoStanceService(llm);
  }

  it('filters recommendedOver/losesTo to known competitors only', async () => {
    const service = makeService((_req, validate) =>
      Promise.resolve({
        data: validate({
          stance: 'recommended_primary',
          rankAmongBrands: 1,
          brandsNamed: ['Rival A', 'Rival B'],
          recommendedOver: ['Rival A', 'Rival B'],
          losesTo: [],
          otherNamesSeen: ['Rival A', 'Rival B'],
          evidenceQuote: 'quote',
          rationale: 'because',
        }),
        model: 'm',
        costUsd: 0.001,
      }),
    );
    const result = await service.judge({
      observationId: 'o1',
      rawAnswer: 'answer text',
      subjectName: 'Acme',
      knownCompetitorNames: ['Rival A'],
    });
    expect(result.recommendedOver).toEqual(['Rival A']);
    expect(result.otherNamesSeen).toEqual(['Rival B']);
  });

  it('strips non-competitor platforms and the subject brand from otherNamesSeen', async () => {
    const service = makeService((_req, validate) =>
      Promise.resolve({
        data: validate({
          stance: 'mentioned_neutral',
          rankAmongBrands: null,
          brandsNamed: [],
          recommendedOver: [],
          losesTo: [],
          otherNamesSeen: ['ChatGPT', 'Acme', 'Real Rival'],
          evidenceQuote: null,
          rationale: null,
        }),
        model: 'm',
        costUsd: 0,
      }),
    );
    const result = await service.judge({ observationId: 'o1', rawAnswer: 'x', subjectName: 'Acme', knownCompetitorNames: [] });
    expect(result.otherNamesSeen).toEqual(['Real Rival']);
  });

  it('throws on an unrecognized stance value rather than guessing one', async () => {
    const service = makeService((_req, validate) => Promise.resolve({ data: validate({ stance: 'not-a-real-stance' }), model: 'm', costUsd: 0 }));
    await expect(service.judge({ observationId: 'o1', rawAnswer: 'x', subjectName: 'Acme', knownCompetitorNames: [] })).rejects.toThrow(/stance/);
  });

  it('caps the evidence quote length', async () => {
    const longQuote = 'x'.repeat(500);
    const service = makeService((_req, validate) =>
      Promise.resolve({
        data: validate({ stance: 'absent', rankAmongBrands: null, brandsNamed: [], recommendedOver: [], losesTo: [], otherNamesSeen: [], evidenceQuote: longQuote, rationale: null }),
        model: 'm',
        costUsd: 0,
      }),
    );
    const result = await service.judge({ observationId: 'o1', rawAnswer: 'x', subjectName: 'Acme', knownCompetitorNames: [] });
    expect(result.evidenceQuote!.length).toBe(280);
  });
});
