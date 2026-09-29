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

  describe('with direct competitors from the business brief', () => {
    const judgeWith = (data: Record<string, unknown>) =>
      makeService((_req, validate) => Promise.resolve({ data: validate({ stance: 'absent', rankAmongBrands: null, brandsNamed: [], recommendedOver: [], losesTo: [], otherNamesSeen: [], evidenceQuote: null, rationale: null, ...data }), model: 'm', costUsd: 0 }));

    it('counts a question as lost when the answer recommends rivals and the subject is absent', async () => {
      const service = judgeWith({ stance: 'absent', brandsNamed: ['Woohoo', 'GyFTR'], directCompetitors: ['Woohoo', 'GyFTR'], losesTo: ['Woohoo', 'GyFTR'], otherNamesSeen: ['Woohoo', 'GyFTR'] });
      const result = await service.judge({ observationId: 'o1', rawAnswer: 'x', subjectName: 'Faydo', knownCompetitorNames: [], businessBrief: 'Faydo sells discounted gift cards' });
      expect(result.losesTo).toEqual(['Woohoo', 'GyFTR']);
      expect(result.otherNamesSeen).toEqual(['Woohoo', 'GyFTR']);
    });

    it('does not treat merchants the subject resells, or platforms, as rivals', async () => {
      const service = judgeWith({
        brandsNamed: ['Amazon', 'Flipkart', 'Woohoo', 'ChatGPT'],
        directCompetitors: ['Woohoo', 'ChatGPT'],
        losesTo: ['Amazon', 'Flipkart', 'Woohoo', 'ChatGPT'],
        recommendedOver: ['Amazon'],
        otherNamesSeen: ['Amazon', 'Flipkart', 'Woohoo'],
      });
      const result = await service.judge({ observationId: 'o1', rawAnswer: 'x', subjectName: 'Faydo', knownCompetitorNames: [] });
      expect(result.losesTo).toEqual(['Woohoo']);
      expect(result.recommendedOver).toEqual([]);
      expect(result.otherNamesSeen).toEqual(['Woohoo']);
    });

    it('does not re-file a rival that is already on file as a new candidate', async () => {
      const service = judgeWith({ directCompetitors: ['Woohoo'], losesTo: ['Woohoo'], otherNamesSeen: ['Woohoo'] });
      const result = await service.judge({ observationId: 'o1', rawAnswer: 'x', subjectName: 'Faydo', knownCompetitorNames: ['Woohoo'] });
      expect(result.losesTo).toEqual(['Woohoo']);
      expect(result.otherNamesSeen).toEqual([]);
    });

    it('sends the business brief to the model', async () => {
      const seen: string[] = [];
      const service = makeService((req, validate) => {
        seen.push((req as { user: string }).user);
        return Promise.resolve({ data: validate({ stance: 'absent' }), model: 'm', costUsd: 0 });
      });
      await service.judge({ observationId: 'o1', rawAnswer: 'answer', subjectName: 'Faydo', knownCompetitorNames: [], businessBrief: 'Subject: Faydo, sells discounted gift cards' });
      expect(seen[0]).toContain('discounted gift cards');
    });
  });
});
