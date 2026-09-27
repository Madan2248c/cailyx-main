import { describe, expect, it, vi } from 'vitest';
import { LlmService } from '../../llm/llm.service.js';
import { GapAnalysisGenerationService } from './gap-analysis-generation.service.js';
import type { SourceFinding } from '../gap-analysis.types.js';

const FINDINGS: SourceFinding[] = [{ module: 'technical-audit', findingRef: 'sitemap', summary: 'stale sitemap' }];

describe('GapAnalysisGenerationService', () => {
  function makeService(jsonImpl: (req: unknown, validate: (raw: unknown) => unknown) => unknown) {
    const llm = { json: vi.fn(jsonImpl) } as unknown as LlmService;
    return new GapAnalysisGenerationService(llm);
  }

  it('parses a well-formed recommendation list', async () => {
    const service = makeService((_req, validate) =>
      Promise.resolve({
        data: validate({
          recommendations: [
            { title: 'Refresh the sitemap', description: 'Regenerate on publish.', sourceFindings: [{ module: 'technical-audit', findingRef: 'sitemap' }] },
          ],
        }),
        model: 'm',
      }),
    );
    const result = await service.consolidate(FINDINGS);
    expect(result).toEqual([
      { title: 'Refresh the sitemap', description: 'Regenerate on publish.', sourceFindings: [{ module: 'technical-audit', findingRef: 'sitemap' }] },
    ]);
  });

  it('drops malformed entries rather than guessing missing fields', async () => {
    const service = makeService((_req, validate) =>
      Promise.resolve({
        data: validate({
          recommendations: [
            { title: 'ok', description: 'd', sourceFindings: [{ module: 'technical-audit', findingRef: 'sitemap' }] },
            { title: 'missing-description', sourceFindings: [{ module: 'technical-audit', findingRef: 'sitemap' }] },
            { title: 'no-citations', description: 'd', sourceFindings: [] },
            { title: 'bad-module', description: 'd', sourceFindings: [{ module: 'not-a-real-module', findingRef: 'x' }] },
          ],
        }),
        model: 'm',
      }),
    );
    const result = await service.consolidate(FINDINGS);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe('ok');
  });

  it('throws when the response has no recommendations array', async () => {
    const service = makeService((_req, validate) => Promise.resolve({ data: validate({}), model: 'm' }));
    await expect(service.consolidate(FINDINGS)).rejects.toThrow(/recommendations/);
  });
});
