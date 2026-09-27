import { describe, expect, it, vi } from 'vitest';
import { TechnicalAuditService } from '../../technical-audit/services/technical-audit.service.js';
import { TechnicalAuditCollector } from './technical-audit.collector.js';

describe('TechnicalAuditCollector', () => {
  it('returns null when no run is COMPLETE', async () => {
    const service = { listRuns: vi.fn().mockResolvedValue([{ id: 'r1', status: 'FAILED' }]) } as unknown as TechnicalAuditService;
    const collector = new TechnicalAuditCollector(service);
    expect(await collector.collect('client-1', 'project-1')).toBeNull();
  });

  it('flattens findings + score + narrative from the latest COMPLETE run', async () => {
    const service = {
      listRuns: vi.fn().mockResolvedValue([
        {
          id: 'r1',
          status: 'COMPLETE',
          score: 86,
          narrative: 'Solid technical health.',
          findings: [{ type: 'sitemap', status: 'pass', severity: 'low', recommendedFix: 'Keep it fresh.' }],
        },
      ]),
    } as unknown as TechnicalAuditService;
    const collector = new TechnicalAuditCollector(service);
    const result = await collector.collect('client-1', 'project-1');
    expect(result!.runId).toBe('r1');
    expect(result!.findings).toContainEqual({ module: 'technical-audit', findingRef: 'sitemap', summary: '[pass/low] sitemap: Keep it fresh.' });
    expect(result!.findings).toContainEqual({ module: 'technical-audit', findingRef: 'composite-score', summary: 'Composite technical/SEO score: 86/100.' });
    expect(result!.findings.some((f) => f.findingRef === 'narrative')).toBe(true);
  });
});
