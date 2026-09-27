import { describe, expect, it, vi } from 'vitest';
import { AeoAuditService } from '../../aeo-audit/services/aeo-audit.service.js';
import { AeoAuditCollector } from './aeo-audit.collector.js';

describe('AeoAuditCollector', () => {
  it('returns null when no audit is completed', async () => {
    const service = { list: vi.fn().mockResolvedValue([{ id: 'a1', status: 'failed' }]) } as unknown as AeoAuditService;
    const collector = new AeoAuditCollector(service);
    expect(await collector.collect('client-1', 'project-1')).toBeNull();
  });

  it('flattens headlines + competitor standing + losing prompts from the recomputed verdict', async () => {
    const service = {
      list: vi.fn().mockResolvedValue([{ id: 'a1', status: 'completed' }]),
      getVerdict: vi.fn().mockResolvedValue({
        headlines: ['Mentioned in 50% of 2 observations.'],
        counted: { competitorStanding: [{ name: 'Rival Co', timesAhead: 0, timesBehind: 1, coMentions: 2 }] },
        judged: { losingPrompts: [{ observationId: 'o1', prompt: 'Who is best?', losesTo: ['Rival Co'] }], winningPrompts: [], stanceCounts: {} },
      }),
    } as unknown as AeoAuditService;
    const collector = new AeoAuditCollector(service);
    const result = await collector.collect('client-1', 'project-1');
    expect(result!.findings).toContainEqual({ module: 'aeo-audit', findingRef: 'headline:0', summary: 'Mentioned in 50% of 2 observations.' });
    expect(result!.findings.some((f) => f.findingRef === 'competitor:Rival Co')).toBe(true);
    expect(result!.findings.some((f) => f.findingRef === 'losing-prompt:o1')).toBe(true);
  });
});
