import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../test/mocks/prisma.mock.js';
import { CloroAiModeAdapter, CloroChatGptAdapter, CloroGeminiAdapter, CloroGoogleAiOverviewAdapter, CloroPerplexityAdapter } from '../adapters/cloro.adapter.js';
import { MockSurfaceAdapter } from '../adapters/mock.adapter.js';
import { MeasurementService } from './measurement.service.js';

/**
 * The orchestrator's decisions: unknown surface / low runCount / non-active
 * set all reject before any adapter is touched; cost-cap stops mid-run and
 * marks it failed; a failed run's retry wipes stale observations; empty
 * cohort returns null rates, never zero.
 */
describe('MeasurementService', () => {
  let service: MeasurementService;
  let prisma: PrismaMock;
  let mockAdapter: { name: string; runPrompt: ReturnType<typeof vi.fn> };
  let config: { get: ReturnType<typeof vi.fn> };

  const project = { id: 'project-1', clientId: 'client-1', deletedAt: null, name: 'Northwind', domain: 'northwind.io' };

  function querySetRow(overrides: Record<string, unknown> = {}) {
    return { id: 'qs-1', projectId: 'project-1', status: 'active', items: [{ id: 'item-1', prompt: 'What is X?' }], ...overrides };
  }

  function runRow(overrides: Record<string, unknown> = {}) {
    return { id: 'run-1', projectId: 'project-1', querySetId: 'qs-1', surface: 'mock', geo: 'US', runCount: 1, status: 'pending', costTotal: 0, completedRequests: 0, ...overrides };
  }

  beforeEach(async () => {
    prisma = createPrismaMock();
    config = { get: vi.fn((_key: string, fallback?: unknown) => fallback) };
    mockAdapter = { name: 'mock', runPrompt: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MeasurementService,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: ConfigService, useValue: config },
        { provide: CloroChatGptAdapter, useValue: { name: 'cloro_chatgpt', runPrompt: vi.fn() } },
        { provide: CloroPerplexityAdapter, useValue: { name: 'cloro_perplexity', runPrompt: vi.fn() } },
        { provide: CloroGeminiAdapter, useValue: { name: 'cloro_gemini', runPrompt: vi.fn() } },
        { provide: CloroGoogleAiOverviewAdapter, useValue: { name: 'cloro_ai_overview', runPrompt: vi.fn() } },
        { provide: CloroAiModeAdapter, useValue: { name: 'cloro_ai_mode', runPrompt: vi.fn() } },
        { provide: MockSurfaceAdapter, useValue: mockAdapter },
      ],
    }).compile();
    service = moduleRef.get(MeasurementService);
  });

  describe('createRun', () => {
    it('400s on an unknown surface', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      await expect(
        service.createRun('client-1', 'project-1', { querySetId: 'qs-1', surface: 'not-a-surface' as never }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400s on runCount below the minimum', async () => {
      await expect(
        service.createRun('client-1', 'project-1', { querySetId: 'qs-1', surface: 'mock', runCount: 0 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s when the project is not the caller client', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(service.createRun('client-1', 'project-1', { querySetId: 'qs-1', surface: 'mock' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409s on a non-active query set — immutability is what makes the cohort comparable', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.querySet.findFirst.mockResolvedValue(querySetRow({ status: 'draft' }));
      await expect(service.createRun('client-1', 'project-1', { querySetId: 'qs-1', surface: 'mock' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('400s on an empty active set', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.querySet.findFirst.mockResolvedValue(querySetRow({ items: [] }));
      await expect(service.createRun('client-1', 'project-1', { querySetId: 'qs-1', surface: 'mock' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates a pending run for a valid active set', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.querySet.findFirst.mockResolvedValue(querySetRow());
      prisma.measurementRun.create.mockResolvedValue(runRow());
      const run = await service.createRun('client-1', 'project-1', { querySetId: 'qs-1', surface: 'mock' });
      expect(run.status).toBe('pending');
    });
  });

  describe('executeRun', () => {
    it('409s when the run is already running or completed', async () => {
      prisma.measurementRun.findUnique.mockResolvedValue(runRow({ status: 'running' }));
      await expect(service.executeRun('run-1')).rejects.toBeInstanceOf(ConflictException);
      prisma.measurementRun.findUnique.mockResolvedValue(runRow({ status: 'completed' }));
      await expect(service.executeRun('run-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('wipes stale observations before retrying a failed run', async () => {
      prisma.measurementRun.findUnique.mockResolvedValue(runRow({ status: 'failed' }));
      prisma.querySet.findUnique.mockResolvedValue(querySetRow());
      prisma.project.findUnique.mockResolvedValue(project);
      mockAdapter.runPrompt.mockResolvedValue({ text: 'answer mentioning Northwind', citations: [], costUsd: 0, latencyMs: 5, model: 'mock' });
      prisma.measurementRun.findUnique.mockResolvedValueOnce(runRow({ status: 'failed' })).mockResolvedValue(runRow({ status: 'running', costTotal: 0, completedRequests: 1 }));

      await service.executeRun('run-1');

      expect(prisma.observation.deleteMany).toHaveBeenCalledWith({ where: { runId: 'run-1' } });
    });

    it('stops and marks failed when the cost cap is exceeded mid-run', async () => {
      config.get.mockImplementation((key: string, fallback?: unknown) => (key === 'MEASUREMENT_MAX_COST_PER_RUN' ? '1.00' : fallback));
      prisma.measurementRun.findUnique
        .mockResolvedValueOnce(runRow({ status: 'pending' }))
        .mockResolvedValue(runRow({ status: 'running', costTotal: 2.5, completedRequests: 1 }));
      prisma.querySet.findUnique.mockResolvedValue(querySetRow({ items: [{ id: 'item-1', prompt: 'p1' }, { id: 'item-2', prompt: 'p2' }] }));
      prisma.project.findUnique.mockResolvedValue(project);
      mockAdapter.runPrompt.mockResolvedValue({ text: 'irrelevant', citations: [], costUsd: 2.5, latencyMs: 1, model: 'mock' });

      await service.executeRun('run-1');

      const finalUpdate = prisma.measurementRun.update.mock.calls.at(-1)![0] as { data: { status: string; error: string | null } };
      expect(finalUpdate.data.status).toBe('failed');
      expect(finalUpdate.data.error).toMatch(/Cost cap exceeded/);
      // Only one prompt's worth of calls should have happened before the cap stopped the loop.
      expect(mockAdapter.runPrompt).toHaveBeenCalledTimes(1);
    });

    it('isolates one failed observation — the run still completes for the rest', async () => {
      prisma.measurementRun.findUnique
        .mockResolvedValueOnce(runRow({ status: 'pending' }))
        .mockResolvedValue(runRow({ status: 'running', costTotal: 0, completedRequests: 1 }));
      prisma.querySet.findUnique.mockResolvedValue(querySetRow({ items: [{ id: 'item-1', prompt: 'p1' }, { id: 'item-2', prompt: 'p2' }] }));
      prisma.project.findUnique.mockResolvedValue(project);
      mockAdapter.runPrompt
        .mockRejectedValueOnce(new Error('surface exploded'))
        .mockResolvedValueOnce({ text: 'ok', citations: [], costUsd: 0, latencyMs: 1, model: 'mock' });

      await service.executeRun('run-1');

      expect(prisma.observation.create).toHaveBeenCalledTimes(1);
      const failedIncrement = prisma.measurementRun.update.mock.calls.find(
        (c) => (c[0] as { data: { failedRequests?: unknown } }).data.failedRequests,
      );
      expect(failedIncrement).toBeDefined();
    });
  });

  describe('summary', () => {
    it('returns null rates for an empty cohort — never zero', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.observation.findMany.mockResolvedValue([]);
      prisma.measurementRun.count.mockResolvedValue(0);
      const result = await service.summary('client-1', 'project-1');
      expect(result.mentionRate).toBeNull();
      expect(result.citationRate).toBeNull();
      expect(result.observations).toBe(0);
    });

    it('computes rates over a real cohort and never populates shareOfVoice', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.observation.findMany.mockResolvedValue([
        { runId: 'run-1', itemId: 'item-1', mentioned: true, cited: true },
        { runId: 'run-1', itemId: 'item-1', mentioned: false, cited: false },
      ]);
      prisma.measurementRun.count.mockResolvedValue(1);
      prisma.querySetItem.findMany.mockResolvedValue([{ id: 'item-1', funnelStage: 'problem_aware' }]);
      prisma.measurementRun.findMany.mockResolvedValue([{ id: 'run-1', surface: 'mock' }]);

      const result = await service.summary('client-1', 'project-1');
      expect(result.mentionRate).toBe(0.5);
      expect(result.citationRate).toBe(0.5);
      expect(result.shareOfVoice).toEqual([]);
    });

    it("404s when a runId is passed that is not this project's", async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.measurementRun.findFirst.mockResolvedValue(null);
      await expect(service.summary('client-1', 'project-1', 'foreign-run')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
