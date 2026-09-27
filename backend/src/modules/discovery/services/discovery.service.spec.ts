import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../test/mocks/prisma.mock.js';
import { DISCOVERY_QUEUE } from '../queue/discovery.queue.js';
import { DiscoveryService } from './discovery.service.js';
import { CompileStage } from './stages/compile.stage.js';
import { ConsolidateStage } from './stages/consolidate.stage.js';
import { DiscoverStage } from './stages/discover.stage.js';
import { ExternalEnrichStage } from './stages/external-enrich.stage.js';
import { ExtractStage } from './stages/extract.stage.js';
import { GapResearchStage } from './stages/gap-research.stage.js';
import { InspectStage } from './stages/inspect.stage.js';
import { ReconcileStage } from './stages/reconcile.stage.js';
import { SelectStage } from './stages/select.stage.js';
import { SocialDiscoveryStage } from './stages/social-discovery.stage.js';
import { ValidateStage } from './stages/validate.stage.js';
import { VerifyStage } from './stages/verify.stage.js';

/**
 * The orchestrator's job is not to run stages but to decide: where a resumed
 * run starts, when to stop and hand over to a continuation job, and what status
 * a finished run gets. Those are the decisions a wrong profile or a
 * silently-stuck run comes from.
 */

describe('DiscoveryService', () => {
  let service: DiscoveryService;
  let prisma: PrismaMock;
  let queue: { add: ReturnType<typeof vi.fn> };
  let stages: Record<string, { run: ReturnType<typeof vi.fn> }>;

  const project = { id: 'project-1', name: 'Northwind Analytics', domain: 'northwind.io', deletedAt: null };

  function runRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'run-1',
      projectId: 'project-1',
      status: 'QUEUED',
      stage: null,
      pagesSpent: 2,
      requestsSpent: 5,
      charsSpent: 1000,
      elapsedMs: 30_000,
      overallConfidence: null,
      overallCompleteness: null,
      profileVersion: 1,
      error: null,
      notes: [],
      pipelineState: {},
      startedAt: null,
      completedAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      project,
      ...overrides,
    };
  }

  /** A profile whose identity decision carries the given confidence. */
  function profileWithIdentity(confidence: number) {
    return {
      profileJson: {
        identity: {
          company_type: { fact_id: 'fact-company-type-001', value: 'company', status: 'supported', fact_type: 'strong_inference', confidence, last_checked_at: '', evidence_ids: [], evidence: [] },
        },
      },
    };
  }

  beforeEach(async () => {
    prisma = createPrismaMock();
    queue = { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };
    stages = {
      discover: { run: vi.fn() },
      inspect: { run: vi.fn() },
      select: { run: vi.fn() },
      extract: { run: vi.fn() },
      reconcile: { run: vi.fn() },
      validate: { run: vi.fn() },
      socialDiscovery: { run: vi.fn() },
      externalEnrich: { run: vi.fn() },
      consolidate: { run: vi.fn() },
      gapResearch: { run: vi.fn() },
      verify: { run: vi.fn() },
      compile: { run: vi.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DiscoveryService,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: ConfigService, useValue: { get: vi.fn() } },
        { provide: getQueueToken(DISCOVERY_QUEUE), useValue: queue },
        { provide: DiscoverStage, useValue: stages.discover },
        { provide: InspectStage, useValue: stages.inspect },
        { provide: SelectStage, useValue: stages.select },
        { provide: ExtractStage, useValue: stages.extract },
        { provide: ReconcileStage, useValue: stages.reconcile },
        { provide: ValidateStage, useValue: stages.validate },
        { provide: SocialDiscoveryStage, useValue: stages.socialDiscovery },
        { provide: ExternalEnrichStage, useValue: stages.externalEnrich },
        { provide: ConsolidateStage, useValue: stages.consolidate },
        { provide: GapResearchStage, useValue: stages.gapResearch },
        { provide: VerifyStage, useValue: stages.verify },
        { provide: CompileStage, useValue: stages.compile },
      ],
    }).compile();

    service = moduleRef.get(DiscoveryService);
    prisma.discoveryRun.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'run-1', ...data }));
    prisma.discoveredPage.findMany.mockResolvedValue([]);
  });

  /** The stage names that actually ran, in order. */
  function ranStages(): string[] {
    return Object.entries(stages)
      .filter(([, double]) => double.run.mock.calls.length > 0)
      .map(([name]) => name);
  }

  describe('resuming', () => {
    it('starts a fresh run at the first stage', async () => {
      prisma.discoveryRun.findUnique.mockResolvedValue(runRow());
      prisma.companyContextProfile.findFirst.mockResolvedValue(profileWithIdentity(0.8));

      await service.executeRun('run-1');

      expect(stages.discover.run).toHaveBeenCalledTimes(1);
      expect(stages.compile.run).toHaveBeenCalledTimes(1);
      expect(ranStages()).toHaveLength(12);
    });

    it('resumes from the stage after the last completed one, never re-running an earlier stage', async () => {
      prisma.discoveryRun.findUnique.mockResolvedValue(runRow({ stage: 'EXTRACT', status: 'PAUSED' }));
      prisma.companyContextProfile.findFirst.mockResolvedValue(profileWithIdentity(0.8));

      await service.executeRun('run-1');

      expect(stages.extract.run).not.toHaveBeenCalled();
      expect(stages.discover.run).not.toHaveBeenCalled();
      expect(stages.reconcile.run).toHaveBeenCalledTimes(1);
      expect(ranStages()).toEqual([
        'reconcile',
        'validate',
        'socialDiscovery',
        'externalEnrich',
        'consolidate',
        'gapResearch',
        'verify',
        'compile',
      ]);
    });

    it('checkpoints the stage column after each stage', async () => {
      prisma.discoveryRun.findUnique.mockResolvedValue(runRow({ stage: 'VERIFY', status: 'RUNNING' }));
      prisma.companyContextProfile.findFirst.mockResolvedValue(profileWithIdentity(0.8));

      await service.executeRun('run-1');

      const stageWrites = prisma.discoveryRun.update.mock.calls
        .map(([args]) => args as { data: Record<string, unknown> })
        .filter((args) => typeof args.data.stage === 'string')
        .map((args) => args.data.stage);
      expect(stageWrites).toEqual(['COMPILE']);
    });

    it('reports progress for every stage it runs', async () => {
      prisma.discoveryRun.findUnique.mockResolvedValue(runRow({ stage: 'GAP_RESEARCH', status: 'RUNNING' }));
      prisma.companyContextProfile.findFirst.mockResolvedValue(profileWithIdentity(0.8));
      const onProgress = vi.fn();

      await service.executeRun('run-1', { onProgress });

      expect(onProgress.mock.calls.map(([stage]) => stage)).toEqual(['VERIFY', 'COMPILE']);
    });
  });

  describe('terminal and invalid runs', () => {
    it('does nothing for a run that already finished', async () => {
      prisma.discoveryRun.findUnique.mockResolvedValue(runRow({ status: 'COMPLETE' }));

      await service.executeRun('run-1');

      expect(ranStages()).toEqual([]);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('fails a run whose project was archived, with the reason', async () => {
      prisma.discoveryRun.findUnique.mockResolvedValue(
        runRow({ project: { ...project, deletedAt: new Date() } }),
      );

      await service.executeRun('run-1');

      expect(ranStages()).toEqual([]);
      expect(prisma.discoveryRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED', error: expect.stringContaining('archived') }),
        }),
      );
    });

    it('throws for a run that does not exist', async () => {
      prisma.discoveryRun.findUnique.mockResolvedValue(null);

      await expect(service.executeRun('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('pausing on the elapsed budget', () => {
    it('checkpoints, marks the run paused, and enqueues a continuation job', async () => {
      prisma.discoveryRun.findUnique.mockResolvedValue(
        runRow({
          status: 'RUNNING',
          stage: 'DISCOVER',
          // A zero per-job ceiling: the very first deadline check trips.
          pipelineState: {
            budgets: { maxPages: 12, maxRequests: 40, maxChars: 24_000, maxElapsedMs: 0, maxRetriesPerPage: 2 },
          },
        }),
      );

      await service.executeRun('run-1');

      // The stage it was about to run never ran.
      expect(stages.inspect.run).not.toHaveBeenCalled();
      expect(prisma.discoveryRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PAUSED' }) }),
      );
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add.mock.calls[0][1]).toMatchObject({ discoveryRunId: 'run-1', reason: 'continuation' });
    });

    it('does not pause while the budget holds', async () => {
      prisma.discoveryRun.findUnique.mockResolvedValue(runRow({ status: 'RUNNING', stage: 'VERIFY' }));
      prisma.companyContextProfile.findFirst.mockResolvedValue(profileWithIdentity(0.8));

      await service.executeRun('run-1');

      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('Definition-of-Done status', () => {
    async function finishWith(profile: unknown, pages: unknown[]): Promise<string | undefined> {
      prisma.discoveryRun.findUnique.mockResolvedValue(runRow({ stage: 'VERIFY', status: 'RUNNING' }));
      prisma.companyContextProfile.findFirst.mockResolvedValue(profile);
      prisma.discoveredPage.findMany.mockResolvedValue(pages);

      await service.executeRun('run-1');

      const final = prisma.discoveryRun.update.mock.calls
        .map(([args]) => args as { data: Record<string, unknown> })
        .reverse()
        .find((args) => typeof args.data.status === 'string' && ['COMPLETE', 'COMPLETE_WITH_GAPS', 'MANUAL_REVIEW_REQUIRED'].includes(args.data.status as string));
      return final?.data.status as string | undefined;
    }

    const coveredPages = [
      { fetchStatus: 'FETCHED', pipelineState: { selected: true, extractStatus: 'done' } },
      { fetchStatus: 'FETCHED', pipelineState: { selected: true, extractStatus: 'done' } },
    ];

    it('is COMPLETE when identity is confident and the pages were analyzed', async () => {
      expect(await finishWith(profileWithIdentity(0.8), coveredPages)).toBe('COMPLETE');
    });

    it('is MANUAL_REVIEW_REQUIRED when identity confidence is below the floor', async () => {
      expect(await finishWith(profileWithIdentity(0.5), coveredPages)).toBe('MANUAL_REVIEW_REQUIRED');
    });

    it('reads identity confidence from the identity decision, not from a fact-level score', async () => {
      // A high fact-level confidence on a company_type value that is not the
      // identity decision must not talk this gate into COMPLETE.
      const profile = profileWithIdentity(0.2);
      profile.profileJson.identity.company_type.confidence = 0.2;
      (profile.profileJson.identity as Record<string, unknown>).business_name = { confidence: 0.95 };

      expect(await finishWith(profile, coveredPages)).toBe('MANUAL_REVIEW_REQUIRED');
    });

    it('is COMPLETE_WITH_GAPS when too few fetched pages were analyzed', async () => {
      const pages = [
        { fetchStatus: 'FETCHED', pipelineState: { selected: true, extractStatus: 'done' } },
        { fetchStatus: 'FETCHED', pipelineState: { selected: true, extractStatus: 'pending' } },
        { fetchStatus: 'FETCHED', pipelineState: { selected: true, extractStatus: 'pending' } },
        { fetchStatus: 'FETCHED', pipelineState: { selected: true, extractStatus: 'pending' } },
      ];

      expect(await finishWith(profileWithIdentity(0.8), pages)).toBe('COMPLETE_WITH_GAPS');
    });

    it('is MANUAL_REVIEW_REQUIRED when compile produced no profile at all', async () => {
      expect(await finishWith(null, coveredPages)).toBe('MANUAL_REVIEW_REQUIRED');
    });
  });

  describe('failure handling', () => {
    it('records the error and rethrows so the queue can retry', async () => {
      prisma.discoveryRun.findUnique.mockResolvedValue(runRow({ status: 'RUNNING', stage: 'DISCOVER' }));
      stages.inspect.run.mockRejectedValue(new Error('worker exploded'));

      await expect(service.executeRun('run-1')).rejects.toThrow('worker exploded');

      expect(prisma.discoveryRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED', error: 'worker exploded' }),
        }),
      );
      // The stage column is NOT advanced — a retry re-runs the stage that failed.
      const stageWrites = prisma.discoveryRun.update.mock.calls
        .map(([args]) => args as { data: Record<string, unknown> })
        .filter((args) => args.data.stage === 'INSPECT');
      expect(stageWrites).toEqual([]);
    });
  });

  describe('startRun', () => {
    it('creates a run, versions it from the last profile, and queues it', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.companyContextProfile.findFirst.mockResolvedValue({ version: 2 });
      prisma.discoveryRun.create.mockResolvedValue({ id: 'run-9', projectId: 'project-1' });

      await service.startRun('project-1');

      expect(prisma.discoveryRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ projectId: 'project-1', status: 'QUEUED', profileVersion: 3 }),
        }),
      );
      expect(queue.add).toHaveBeenCalledWith(
        'run',
        expect.objectContaining({ discoveryRunId: 'run-9', reason: 'project-created' }),
        expect.anything(),
      );
    });

    it('records a failure on the run instead of throwing when the queue is unreachable', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.companyContextProfile.findFirst.mockResolvedValue(null);
      prisma.discoveryRun.create.mockResolvedValue({ id: 'run-9', projectId: 'project-1' });
      queue.add.mockRejectedValue(new Error('redis is down'));

      await expect(service.startRun('project-1')).resolves.toMatchObject({ id: 'run-9' });

      expect(prisma.discoveryRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED', error: expect.stringContaining('redis is down') }),
        }),
      );
    });

    it('refuses a project that does not exist', async () => {
      prisma.project.findFirst.mockResolvedValue(null);

      await expect(service.startRun('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('rerun', () => {
    it('resumes an unfinished run instead of paying for a second crawl', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.discoveryRun.findFirst.mockResolvedValue({ id: 'run-7', projectId: 'project-1', status: 'PAUSED' });

      const result = await service.rerun('client-1', 'project-1');

      // Same run, re-queued — not a new row, and no second profile version.
      expect(result).toMatchObject({ id: 'run-7' });
      expect(prisma.discoveryRun.create).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledWith(
        'run',
        expect.objectContaining({ discoveryRunId: 'run-7', reason: 'retry' }),
        expect.anything(),
      );
    });

    it('starts a fresh run when there is nothing to resume', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.discoveryRun.findFirst.mockResolvedValue(null);
      prisma.companyContextProfile.findFirst.mockResolvedValue(null);
      prisma.discoveryRun.create.mockResolvedValue({ id: 'run-new', projectId: 'project-1' });

      const result = await service.rerun('client-1', 'project-1');

      expect(result).toMatchObject({ id: 'run-new' });
      expect(queue.add).toHaveBeenCalledWith(
        'run',
        expect.objectContaining({ discoveryRunId: 'run-new', reason: 'manual' }),
        expect.anything(),
      );
    });
  });

  describe('client scoping', () => {
    it('hides a run belonging to another client', async () => {
      prisma.discoveryRun.findUnique.mockResolvedValue(runRow({ project: { clientId: 'client-2' } }));

      await expect(service.getRun('client-1', 'run-1')).rejects.toThrow(NotFoundException);
    });

    it('refuses to read runs of a project outside the caller’s client', async () => {
      prisma.project.findFirst.mockResolvedValue(null);

      await expect(service.listRuns('client-1', 'project-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfileFields', () => {
    const fact = (value: string) => ({
      fact_id: 'f1',
      value,
      status: 'supported',
      fact_type: 'explicit',
      confidence: 0.9,
      last_checked_at: '2026-01-01',
      evidence_ids: [],
      evidence: [],
    });

    function profileRow() {
      return {
        id: 'profile-1',
        profileJson: {
          identity: { business_name: fact('Acme'), legal_name: null },
          customers: { industries: [fact('SaaS'), fact('Fintech')] },
        },
      };
    }

    beforeEach(() => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.companyContextProfile.findFirst.mockResolvedValue(profileRow());
      prisma.companyContextProfile.update.mockImplementation((args: { data: { profileJson: unknown } }) =>
        Promise.resolve({ id: 'profile-1', profileJson: args.data.profileJson }),
      );
    });

    it('updates a scalar in place, keeping its fact metadata', async () => {
      await service.updateProfileFields('client-1', 'project-1', { 'identity.business_name': 'Acme Inc' });

      const written = prisma.companyContextProfile.update.mock.calls[0][0].data.profileJson as {
        identity: { business_name: { value: string; fact_id: string } };
      };
      expect(written.identity.business_name.value).toBe('Acme Inc');
      expect(written.identity.business_name.fact_id).toBe('f1');
    });

    it('clears a scalar on empty string and fills a missing one with a client fact', async () => {
      await service.updateProfileFields('client-1', 'project-1', {
        'identity.business_name': '',
        'identity.legal_name': 'Acme Ltd',
      });

      const written = prisma.companyContextProfile.update.mock.calls[0][0].data.profileJson as {
        identity: { business_name: null; legal_name: { value: string; fact_id: string; evidence: unknown[] } };
      };
      expect(written.identity.business_name).toBeNull();
      expect(written.identity.legal_name.value).toBe('Acme Ltd');
      expect(written.identity.legal_name.evidence).toEqual([]);
    });

    it('replaces an array, preserving surviving facts and minting new ones', async () => {
      await service.updateProfileFields('client-1', 'project-1', {
        'customers.industries': ['Fintech', 'Health'],
      });

      const written = prisma.companyContextProfile.update.mock.calls[0][0].data.profileJson as {
        customers: { industries: Array<{ value: string; fact_id: string }> };
      };
      expect(written.customers.industries.map((f) => f.value)).toEqual(['Fintech', 'Health']);
      expect(written.customers.industries[0].fact_id).toBe('f1');
      expect(written.customers.industries[1].fact_id).not.toBe('f1');
    });

    it('400s on unknown paths and kind mismatches', async () => {
      await expect(
        service.updateProfileFields('client-1', 'project-1', { 'identity.nope': 'x' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateProfileFields('client-1', 'project-1', { 'identity.business_name': ['x'] }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateProfileFields('client-1', 'project-1', { 'customers.industries': 'x' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.companyContextProfile.update).not.toHaveBeenCalled();
    });

    it('404s when no profile exists yet', async () => {
      prisma.companyContextProfile.findFirst.mockResolvedValue(null);

      await expect(
        service.updateProfileFields('client-1', 'project-1', { 'identity.business_name': 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateSocialProfile', () => {
    it('updates the URL and resets verification', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.socialProfile.findFirst.mockResolvedValue({ id: 'sp-1', url: 'old' });
      prisma.socialProfile.update.mockResolvedValue({ id: 'sp-1' });

      await service.updateSocialProfile('client-1', 'project-1', 'sp-1', 'linkedin.com/company/acme');

      expect(prisma.socialProfile.update).toHaveBeenCalledWith({
        where: { id: 'sp-1' },
        data: { url: 'linkedin.com/company/acme', verificationStatus: 'POSSIBLE', score: null, verifiedAt: null },
      });
    });

    it('404s outside the project and 400s on garbage URLs', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.socialProfile.findFirst.mockResolvedValue(null);

      await expect(service.updateSocialProfile('client-1', 'project-1', 'missing', 'x.com/y')).rejects.toThrow(
        NotFoundException,
      );

      prisma.socialProfile.findFirst.mockResolvedValue({ id: 'sp-1', url: 'old' });
      await expect(service.updateSocialProfile('client-1', 'project-1', 'sp-1', 'not a url')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.socialProfile.update).not.toHaveBeenCalled();
    });
  });
});
