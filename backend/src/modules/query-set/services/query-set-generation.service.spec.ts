import { describe, expect, it, vi } from 'vitest';
import { LlmService } from '../../llm/llm.service.js';
import { QuerySetGenerationService } from './query-set-generation.service.js';
import type { BucketProposal } from '../query-set.types.js';

describe('QuerySetGenerationService', () => {
  function makeService(jsonImpl: (req: unknown, validate: (raw: unknown) => unknown) => unknown) {
    const llm = { json: vi.fn(jsonImpl) } as unknown as LlmService;
    return new QuerySetGenerationService(llm);
  }

  describe('proposeBuckets', () => {
    it('parses a well-formed bucket proposal', async () => {
      const service = makeService((_req, validate) =>
        Promise.resolve({
          data: validate({
            buckets: [
              {
                name: 'warehouse-automation-fit',
                rationale: 'Targets warehouse automation buyers.',
                persona: 'buyer',
                funnel_stage: 'problem_aware',
                branding: 'unbranded',
                target_count: 15,
              },
            ],
          }),
          model: 'm',
        }),
      );
      const result = await service.proposeBuckets(['warehouse automation'], 'A robotics company.');
      expect(result).toEqual([
        {
          name: 'warehouse-automation-fit',
          rationale: 'Targets warehouse automation buyers.',
          persona: 'buyer',
          funnelStage: 'problem_aware',
          branding: 'unbranded',
          targetCount: 15,
        },
      ]);
    });

    it('drops malformed bucket entries rather than guessing missing fields', async () => {
      const service = makeService((_req, validate) =>
        Promise.resolve({
          data: validate({
            buckets: [
              { name: 'ok', rationale: 'r', persona: 'buyer', funnel_stage: 'problem_aware', branding: 'unbranded', target_count: 10 },
              { name: 'missing-persona', rationale: 'r', funnel_stage: 'problem_aware', branding: 'unbranded', target_count: 10 },
              { name: 'bad-persona', rationale: 'r', persona: 'not-a-real-persona', funnel_stage: 'problem_aware', branding: 'unbranded', target_count: 10 },
            ],
          }),
          model: 'm',
        }),
      );
      const result = await service.proposeBuckets([], '');
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe('ok');
    });

    it('throws when the response has no buckets array', async () => {
      const service = makeService((_req, validate) => Promise.resolve({ data: validate({}), model: 'm' }));
      await expect(service.proposeBuckets([], '')).rejects.toThrow(/buckets/);
    });
  });

  describe('generatePrompts', () => {
    const bucket: BucketProposal = {
      name: 'b',
      rationale: 'r',
      persona: 'buyer',
      funnelStage: 'problem_aware',
      branding: 'unbranded',
      targetCount: 3,
    };

    it('parses prompt objects and plain strings alike', async () => {
      const service = makeService((_req, validate) =>
        Promise.resolve({
          data: validate({ prompts: [{ prompt: 'What warehouse robots exist?' }, 'How do picking robots work?'] }),
          model: 'm',
        }),
      );
      const result = await service.generatePrompts(bucket, 'A robotics company.');
      expect(result).toEqual(['What warehouse robots exist?', 'How do picking robots work?']);
    });

    it('filters out empty prompt entries', async () => {
      const service = makeService((_req, validate) =>
        Promise.resolve({ data: validate({ prompts: [{ prompt: '  ' }, 'real prompt'] }), model: 'm' }),
      );
      const result = await service.generatePrompts(bucket, '');
      expect(result).toEqual(['real prompt']);
    });
  });
});
