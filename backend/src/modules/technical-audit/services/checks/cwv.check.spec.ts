import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditContext } from '../audit-context.js';
import { PsiService, type PsiResult } from '../psi.service.js';
import { CwvCheck } from './cwv.check.js';

const CTX: AuditContext = { runId: 'run-1', project: { id: 'p1', name: 'Acme', domain: 'acme.com' }, targetUrl: 'https://acme.com' };

function psiResult(overrides: Partial<PsiResult> = {}): PsiResult {
  return {
    url: CTX.targetUrl,
    lcp: 1000,
    cls: 0.01,
    inp: 100,
    performanceScore: 95,
    categories: { performance: 95, seo: 100, accessibility: 90, 'best-practices': 92 },
    failedAudits: [],
    fieldData: null,
    finalUrl: CTX.targetUrl,
    lighthouseVersion: '12.0.0',
    raw: {},
    ...overrides,
  };
}

describe('CwvCheck', () => {
  let check: CwvCheck;
  let psi: { fetchPsi: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    psi = { fetchPsi: vi.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [CwvCheck, { provide: PsiService, useValue: psi }],
    }).compile();
    check = moduleRef.get(CwvCheck);
  });

  it('passes when every metric is in the good band', async () => {
    psi.fetchPsi.mockResolvedValue(psiResult());

    const finding = await check.run(CTX);

    expect(finding.status).toBe('pass');
    expect(finding.severity).toBe('low');
    expect(finding.recommendedFix).toContain('all good');
  });

  it('rates the boundary value itself as good (inclusive <=)', async () => {
    psi.fetchPsi.mockResolvedValue(psiResult({ lcp: 2500, cls: 0.1, inp: 200 }));

    const finding = await check.run(CTX);

    expect(finding.status).toBe('pass');
    const detail = finding.detail as { lcpStatus: string; clsStatus: string; inpStatus: string };
    expect(detail.lcpStatus).toBe('good');
    expect(detail.clsStatus).toBe('good');
    expect(detail.inpStatus).toBe('good');
  });

  it('fails at medium severity when a metric only needs improvement', async () => {
    psi.fetchPsi.mockResolvedValue(psiResult({ lcp: 3000 })); // needs-improvement band

    const finding = await check.run(CTX);

    expect(finding.status).toBe('fail');
    expect(finding.severity).toBe('medium');
    expect(finding.recommendedFix).toContain('need improvement');
  });

  it('fails at high severity when any metric is poor, listing every non-good metric', async () => {
    psi.fetchPsi.mockResolvedValue(psiResult({ lcp: 5000, cls: 0.01, inp: 300 })); // lcp poor, inp needs-improvement

    const finding = await check.run(CTX);

    expect(finding.status).toBe('fail');
    expect(finding.severity).toBe('high');
    expect(finding.recommendedFix).toContain('LCP: 5000ms (poor)');
    expect(finding.recommendedFix).toContain('INP: 300ms (needs-improvement)');
    // CLS itself is not in the failing-metrics list (only its generic mention
    // in the fixed prioritization advice, which is expected boilerplate).
    expect(finding.recommendedFix).not.toContain('CLS: ');
  });

  it('lets a PSI failure (e.g. no API key) propagate rather than swallowing it', async () => {
    psi.fetchPsi.mockRejectedValue(new Error('PSI_API_KEY not configured — cannot fetch Core Web Vitals'));

    await expect(check.run(CTX)).rejects.toThrow('PSI_API_KEY not configured');
  });

  it('carries the full Lighthouse categories/failedAudits/fieldData through to the finding detail', async () => {
    const failedAudits = [{ id: 'unused-css', title: 'Unused CSS', category: 'performance', score: 0.5, description: 'x', displayValue: '' }];
    psi.fetchPsi.mockResolvedValue(psiResult({ failedAudits, fieldData: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2000, category: 'GOOD' } } }));

    const finding = await check.run(CTX);

    const detail = finding.detail as { failedAudits: unknown; fieldData: unknown; categories: Record<string, number> };
    expect(detail.failedAudits).toEqual(failedAudits);
    expect(detail.fieldData).toEqual({ LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2000, category: 'GOOD' } });
    expect(detail.categories.seo).toBe(100);
  });
});
