import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../test/mocks/prisma.mock.js';
import { CloroClient } from '../../measurement/adapters/cloro.adapter.js';
import { MeasurementService } from '../../measurement/services/measurement.service.js';
import { AeoAuditService } from './aeo-audit.service.js';
import { AeoNarrativeService } from './aeo-narrative.service.js';
import { AeoStanceService } from './aeo-stance.service.js';
import { CompetitorService } from './competitor.service.js';

/**
 * The orchestrator's decisions: create() validates surfaces/active-set
 * before spending anything; run() is resumable (only touches pending
 * surface runs), stops new work at the audit-wide cost cap, isolates one
 * surface's failure from the rest, and never completes an audit with zero
 * successful surface runs.
 */
describe('AeoAuditService', () => {
  let service: AeoAuditService;
  let prisma: PrismaMock;
  let measurement: { createRun: ReturnType<typeof vi.fn>; executeRun: ReturnType<typeof vi.fn> };
  let cloro: { getRemainingCredits: ReturnType<typeof vi.fn> };
  let stance: { judge: ReturnType<typeof vi.fn> };
  let narrative: { write: ReturnType<typeof vi.fn> };
  let competitors: { knownNames: ReturnType<typeof vi.fn>; recordCandidate: ReturnType<typeof vi.fn> };
  let config: { get: ReturnType<typeof vi.fn> };

  const project = { id: 'project-1', clientId: 'client-1', deletedAt: null, name: 'Acme', domain: 'acme.io' };

  function auditRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'audit-1',
      projectId: 'project-1',
      querySetId: 'qs-1',
      surfaces: ['cloro_chatgpt'],
      markets: ['US'],
      status: 'pending',
      promptCount: 2,
      costUsd: 0,
      startedAt: null,
      verdict: {},
      ...overrides,
    };
  }

  beforeEach(async () => {
    prisma = createPrismaMock();
    measurement = { createRun: vi.fn(), executeRun: vi.fn() };
    cloro = { getRemainingCredits: vi.fn().mockResolvedValue(10_000) };
    stance = { judge: vi.fn() };
    narrative = { write: vi.fn().mockResolvedValue({ headlines: ['n'], model: 'm', costUsd: 0 }) };
    competitors = { knownNames: vi.fn().mockResolvedValue([]), recordCandidate: vi.fn() };
    config = { get: vi.fn((_key: string, fallback?: unknown) => fallback) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AeoAuditService,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: ConfigService, useValue: config },
        { provide: MeasurementService, useValue: measurement },
        { provide: CloroClient, useValue: cloro },
        { provide: AeoStanceService, useValue: stance },
        { provide: AeoNarrativeService, useValue: narrative },
        { provide: CompetitorService, useValue: competitors },
      ],
    }).compile();
    service = moduleRef.get(AeoAuditService);
  });

  describe('create', () => {
    it('404s when the project is not the caller client', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(service.create('client-1', 'project-1', { querySetId: 'qs-1', surfaces: ['cloro_chatgpt'] })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('400s on an unknown surface', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      await expect(service.create('client-1', 'project-1', { querySetId: 'qs-1', surfaces: ['not-a-surface' as never] })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('409s on a non-active query set', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.querySet.findFirst.mockResolvedValue({ id: 'qs-1', status: 'draft' });
      await expect(service.create('client-1', 'project-1', { querySetId: 'qs-1', surfaces: ['cloro_chatgpt'] })).rejects.toBeInstanceOf(ConflictException);
    });

    it('400s on an empty active set', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.querySet.findFirst.mockResolvedValue({ id: 'qs-1', status: 'active' });
      prisma.querySetItem.count.mockResolvedValue(0);
      await expect(service.create('client-1', 'project-1', { querySetId: 'qs-1', surfaces: ['cloro_chatgpt'] })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates one AeoSurfaceRun per surface x market pair', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.querySet.findFirst.mockResolvedValue({ id: 'qs-1', status: 'active' });
      prisma.querySetItem.count.mockResolvedValue(5);
      prisma.aeoAudit.create.mockResolvedValue(auditRow());
      await service.create('client-1', 'project-1', { querySetId: 'qs-1', surfaces: ['cloro_chatgpt', 'cloro_gemini'], markets: ['US', 'GB'] });
      expect(prisma.aeoSurfaceRun.create).toHaveBeenCalledTimes(4);
    });
  });

  describe('run', () => {
    it('409s on an already-completed audit', async () => {
      prisma.aeoAudit.findFirst.mockResolvedValue(auditRow({ status: 'completed' }));
      await expect(service.run('client-1', 'audit-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('marks the audit failed when zero surface runs complete', async () => {
      prisma.aeoAudit.findFirst.mockResolvedValue(auditRow());
      prisma.project.findUniqueOrThrow.mockResolvedValue(project);
      prisma.aeoSurfaceRun.findMany.mockImplementation((args: { where?: { status?: string } }) =>
        Promise.resolve(args?.where?.status === 'completed' ? [] : [{ id: 'sr-1', surface: 'cloro_chatgpt', market: 'US', status: 'pending' }]),
      );
      measurement.createRun.mockResolvedValue({ id: 'run-1' });
      measurement.executeRun.mockResolvedValue({ status: 'failed', observations: [], costTotal: 0, error: 'boom' });

      await service.run('client-1', 'audit-1');

      const failUpdate = prisma.aeoAudit.update.mock.calls.find((c) => (c[0] as { data: { status?: string } }).data.status === 'failed');
      expect(failUpdate).toBeDefined();
    });

    it('stops new surface runs once the audit-wide cost cap is reached', async () => {
      config.get.mockImplementation((key: string, fallback?: unknown) => (key === 'AEO_MAX_COST_PER_AUDIT' ? '1.00' : fallback));
      prisma.aeoAudit.findFirst.mockResolvedValue(auditRow({ costUsd: 2.0 })); // already over cap
      prisma.project.findUniqueOrThrow.mockResolvedValue(project);
      prisma.aeoSurfaceRun.findMany.mockImplementation((args: { where?: { status?: string } }) =>
        Promise.resolve(args?.where?.status === 'completed' ? [] : [{ id: 'sr-1', surface: 'cloro_chatgpt', market: 'US', status: 'pending' }]),
      );

      await service.run('client-1', 'audit-1');

      expect(measurement.createRun).not.toHaveBeenCalled();
      const capFail = prisma.aeoSurfaceRun.update.mock.calls.find((c) => (c[0] as { data: { failureKind?: string } }).data.failureKind === 'audit-cost-cap');
      expect(capFail).toBeDefined();
    });

    it('isolates one surface run exception from the rest and still completes the audit', async () => {
      prisma.aeoAudit.findFirst.mockResolvedValue(auditRow({ surfaces: ['cloro_chatgpt', 'cloro_gemini'] }));
      prisma.project.findUniqueOrThrow.mockResolvedValue(project);
      prisma.aeoSurfaceRun.findMany.mockImplementation((args: { where?: { status?: string } }) => {
        if (args?.where?.status === 'completed') return Promise.resolve([{ id: 'sr-2' }]);
        return Promise.resolve([
          { id: 'sr-1', surface: 'cloro_chatgpt', market: 'US', status: 'pending' },
          { id: 'sr-2', surface: 'cloro_gemini', market: 'US', status: 'pending' },
        ]);
      });
      measurement.createRun.mockImplementation((_c: string, _p: string, opts: { surface: string }) =>
        opts.surface === 'cloro_chatgpt' ? Promise.reject(new Error('surface exploded')) : Promise.resolve({ id: 'run-2' }),
      );
      measurement.executeRun.mockResolvedValue({ status: 'completed', observations: [], costTotal: 0.01, error: null });
      prisma.observation.findMany.mockResolvedValue([]);
      prisma.aeoStance.findMany.mockResolvedValue([]);
      prisma.aeoAudit.findUniqueOrThrow.mockResolvedValue(auditRow({ verdict: {} }));

      const result = await service.run('client-1', 'audit-1');
      const exceptionFail = prisma.aeoSurfaceRun.update.mock.calls.find((c) => (c[0] as { data: { failureKind?: string } }).data.failureKind === 'exception');
      expect(exceptionFail).toBeDefined();
      expect(result).toBeDefined();
      const completeUpdate = prisma.aeoAudit.update.mock.calls.find((c) => (c[0] as { data: { status?: string } }).data.status === 'completed');
      expect(completeUpdate).toBeDefined();
    });

    it('records stance-discovered candidate names via CompetitorService', async () => {
      prisma.aeoAudit.findFirst.mockResolvedValue(auditRow());
      prisma.project.findUniqueOrThrow.mockResolvedValue(project);
      prisma.aeoSurfaceRun.findMany.mockImplementation((args: { where?: { status?: string } }) =>
        Promise.resolve(args?.where?.status === 'completed' ? [{ id: 'sr-1' }] : [{ id: 'sr-1', surface: 'cloro_chatgpt', market: 'US', status: 'pending' }]),
      );
      measurement.createRun.mockResolvedValue({ id: 'run-1' });
      measurement.executeRun.mockResolvedValue({ status: 'completed', observations: [{ id: 'obs-1' }], costTotal: 0.01, error: null });
      prisma.observation.findMany.mockImplementation((args: { include?: unknown }) =>
        Promise.resolve(
          args?.include
            ? [{ id: 'obs-1', prompt: 'p', mentioned: false, cited: false, run: { surface: 'cloro_chatgpt' }, item: { bucket: null, funnelStage: 'problem_aware', branding: 'unbranded' } }]
            : [{ id: 'obs-1', runId: 'run-1', rawAnswer: 'text' }],
        ),
      );
      prisma.measurementRun.findUniqueOrThrow.mockResolvedValue({ surface: 'cloro_chatgpt' });
      stance.judge.mockResolvedValue({
        observationId: 'obs-1',
        stance: 'mentioned_neutral',
        rankAmongBrands: null,
        brandsNamed: [],
        recommendedOver: [],
        losesTo: [],
        otherNamesSeen: ['New Rival'],
        evidenceQuote: null,
        rationale: null,
        judgeModel: 'm',
        costUsd: 0.001,
      });
      prisma.aeoStance.findMany.mockResolvedValue([]);
      prisma.aeoAudit.findUniqueOrThrow.mockResolvedValue(auditRow({ verdict: {} }));

      await service.run('client-1', 'audit-1');

      expect(competitors.recordCandidate).toHaveBeenCalledWith('project-1', 'New Rival');
    });
  });

  describe('regenerateNarrative', () => {
    it('409s on a non-completed audit — nothing to narrate yet', async () => {
      prisma.aeoAudit.findFirst.mockResolvedValue(auditRow({ status: 'running' }));
      await expect(service.regenerateNarrative('client-1', 'audit-1')).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
