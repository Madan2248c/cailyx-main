import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../test/mocks/prisma.mock.js';
import { AeoAuditCollector } from '../collectors/aeo-audit.collector.js';
import { SocialActivityCollector } from '../collectors/social-activity.collector.js';
import { TechnicalAuditCollector } from '../collectors/technical-audit.collector.js';
import { GapAnalysisGenerationService } from './gap-analysis-generation.service.js';
import { GapAnalysisService } from './gap-analysis.service.js';
import type { RawRecommendation } from '../gap-analysis.types.js';

/**
 * The orchestrator's decisions: 409 when zero sources have a completed
 * run, 409 (not silent auto-fix) when the guardrail-passed recommendation
 * count is out of range, ungrounded/fabricated-number items are dropped
 * before persistence, ranks are contiguous.
 */
describe('GapAnalysisService', () => {
  let service: GapAnalysisService;
  let prisma: PrismaMock;
  let technicalAudit: { collect: ReturnType<typeof vi.fn> };
  let socialActivity: { collect: ReturnType<typeof vi.fn> };
  let aeoAudit: { collect: ReturnType<typeof vi.fn> };
  let generation: { consolidate: ReturnType<typeof vi.fn> };

  const project = { id: 'project-1', clientId: 'client-1', deletedAt: null };
  const taSource = { module: 'technical-audit' as const, runId: 'ta-1', findings: [{ module: 'technical-audit' as const, findingRef: 'sitemap', summary: 'stale sitemap' }] };

  function groundedRec(overrides: Partial<RawRecommendation> = {}): RawRecommendation {
    return {
      title: 'Refresh the sitemap',
      description: 'Regenerate it on publish.',
      sourceFindings: [{ module: 'technical-audit', findingRef: 'sitemap' }],
      ...overrides,
    };
  }

  beforeEach(async () => {
    prisma = createPrismaMock();
    technicalAudit = { collect: vi.fn() };
    socialActivity = { collect: vi.fn() };
    aeoAudit = { collect: vi.fn() };
    generation = { consolidate: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GapAnalysisService,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: TechnicalAuditCollector, useValue: technicalAudit },
        { provide: SocialActivityCollector, useValue: socialActivity },
        { provide: AeoAuditCollector, useValue: aeoAudit },
        { provide: GapAnalysisGenerationService, useValue: generation },
      ],
    }).compile();
    service = moduleRef.get(GapAnalysisService);
  });

  it('404s when the project is not the caller client', async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(service.run('client-1', 'project-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409s when zero sources have a completed run — never invents data to fill the gap', async () => {
    prisma.project.findFirst.mockResolvedValue(project);
    technicalAudit.collect.mockResolvedValue(null);
    socialActivity.collect.mockResolvedValue(null);
    aeoAudit.collect.mockResolvedValue(null);
    await expect(service.run('client-1', 'project-1')).rejects.toBeInstanceOf(ConflictException);
    expect(generation.consolidate).not.toHaveBeenCalled();
    expect(prisma.gapAnalysisRun.create).not.toHaveBeenCalled();
  });

  it('runs on a single available source — a missing source is not an error', async () => {
    prisma.project.findFirst.mockResolvedValue(project);
    technicalAudit.collect.mockResolvedValue(taSource);
    socialActivity.collect.mockResolvedValue(null);
    aeoAudit.collect.mockResolvedValue(null);
    prisma.gapAnalysisRun.create.mockResolvedValue({ id: 'run-1' });
    generation.consolidate.mockResolvedValue([groundedRec(), groundedRec({ title: 'b' }), groundedRec({ title: 'c' })]);
    prisma.gapAnalysisRun.findFirst.mockResolvedValue({ id: 'run-1', recommendations: [] });

    await service.run('client-1', 'project-1');

    expect(prisma.gapAnalysisRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sourceTechnicalAuditRunId: 'ta-1', sourceSocialActivityRunId: null, sourceAeoAuditId: null }) }),
    );
  });

  it('409s when the guardrail-passed count is below the minimum — does not auto-fix', async () => {
    prisma.project.findFirst.mockResolvedValue(project);
    technicalAudit.collect.mockResolvedValue(taSource);
    socialActivity.collect.mockResolvedValue(null);
    aeoAudit.collect.mockResolvedValue(null);
    prisma.gapAnalysisRun.create.mockResolvedValue({ id: 'run-1' });
    generation.consolidate.mockResolvedValue([groundedRec()]); // only 1, below MIN=3

    await expect(service.run('client-1', 'project-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.gapAnalysisRecommendation.create).not.toHaveBeenCalled();
    const failUpdate = prisma.gapAnalysisRun.update.mock.calls.find((c) => (c[0] as { data: { status?: string } }).data.status === 'FAILED');
    expect(failUpdate).toBeDefined();
  });

  it('drops ungrounded recommendations before persisting the rest with contiguous ranks', async () => {
    prisma.project.findFirst.mockResolvedValue(project);
    technicalAudit.collect.mockResolvedValue(taSource);
    socialActivity.collect.mockResolvedValue(null);
    aeoAudit.collect.mockResolvedValue(null);
    prisma.gapAnalysisRun.create.mockResolvedValue({ id: 'run-1' });
    generation.consolidate.mockResolvedValue([
      groundedRec({ title: 'a' }),
      groundedRec({ title: 'ungrounded', sourceFindings: [{ module: 'aeo-audit', findingRef: 'not-real' }] }),
      groundedRec({ title: 'b' }),
      groundedRec({ title: 'c' }),
    ]);
    prisma.gapAnalysisRun.findFirst.mockResolvedValue({ id: 'run-1', recommendations: [] });

    await service.run('client-1', 'project-1');

    const created = prisma.gapAnalysisRecommendation.create.mock.calls.map((c) => (c[0] as { data: { title: string; priorityRank: number } }).data);
    expect(created.map((c) => c.title)).toEqual(['a', 'b', 'c']);
    expect(created.map((c) => c.priorityRank)).toEqual([1, 2, 3]);
  });

  it('setRecommendationStatus 404s outside the caller client', async () => {
    prisma.gapAnalysisRecommendation.findFirst.mockResolvedValue(null);
    await expect(service.setRecommendationStatus('client-1', 'rec-1', 'DONE')).rejects.toBeInstanceOf(NotFoundException);
  });
});
