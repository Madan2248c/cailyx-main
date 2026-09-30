import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../test/mocks/prisma.mock.js';
import { DiscoveryService } from '../../discovery/services/discovery.service.js';
import { TechnicalAuditService } from '../../technical-audit/services/technical-audit.service.js';
import { SocialActivityService } from '../../social-activity/services/social-activity.service.js';
import { QuerySetService } from '../../query-set/services/query-set.service.js';
import { AeoAuditService } from '../../aeo-audit/services/aeo-audit.service.js';
import { CompetitorsService } from '../../competitors/services/competitors.service.js';
import { GapAnalysisService } from '../../gap-analysis/services/gap-analysis.service.js';
import { ReportingService } from '../../reporting/services/reporting.service.js';
import { TeamService } from '../../auth/services/team.service.js';
import { RemediationSyncService } from '../../remediation/services/remediation-sync.service.js';
import { CloroClient } from '../../measurement/adapters/cloro.adapter.js';
import { DAY1_QUEUE } from '../queue/day1-pipeline.queue.js';
import { Day1PipelineService } from './day1-pipeline.service.js';

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pipeline-1',
    projectId: 'project-1',
    clientId: 'client-1',
    status: 'QUEUED',
    currentStage: null,
    stages: {},
    spendCeilingUsd: null,
    spendAuthorizedAt: new Date(),
    reportId: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

describe('Day1PipelineService', () => {
  let service: Day1PipelineService;
  let prisma: PrismaMock;
  let queue: { add: ReturnType<typeof vi.fn> };
  let discovery: { startRun: ReturnType<typeof vi.fn>; getRun: ReturnType<typeof vi.fn> };
  let technicalAudit: { startRun: ReturnType<typeof vi.fn>; getRun: ReturnType<typeof vi.fn> };
  let socialActivity: {
    startRun: ReturnType<typeof vi.fn>;
    getRun: ReturnType<typeof vi.fn>;
    listRuns: ReturnType<typeof vi.fn>;
  };
  let querySets: {
    list: ReturnType<typeof vi.fn>;
    generate: ReturnType<typeof vi.fn>;
    activate: ReturnType<typeof vi.fn>;
  };
  let aeoAudit: {
    create: ReturnType<typeof vi.fn>;
    run: ReturnType<typeof vi.fn>;
    getAudit: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };
  let competitors: { discover: ReturnType<typeof vi.fn> };
  let gapAnalysis: { run: ReturnType<typeof vi.fn> };
  let reporting: { generate: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> };
  let team: { sendDay1ReadyEmail: ReturnType<typeof vi.fn> };
  let remediation: { sync: ReturnType<typeof vi.fn> };
  let cloro: { getRemainingCredits: ReturnType<typeof vi.fn> };

  function mockHappyStages() {
    discovery.startRun.mockResolvedValue({ id: 'd1' });
    discovery.getRun.mockResolvedValue({ id: 'd1', status: 'COMPLETE' });
    technicalAudit.startRun.mockResolvedValue({ id: 't1' });
    technicalAudit.getRun.mockResolvedValue({ id: 't1', status: 'COMPLETE' });
    socialActivity.startRun.mockResolvedValue({ id: 's1' });
    socialActivity.getRun.mockResolvedValue({ id: 's1', status: 'COMPLETE' });
    socialActivity.listRuns.mockResolvedValue([]);
    // Stateful: nothing active until generate+activate run, like the real module.
    const activeSets: Array<{ id: string }> = [];
    querySets.list.mockImplementation((_clientId: string, _projectId: string, status?: string) =>
      Promise.resolve(status === 'active' ? [...activeSets] : []),
    );
    querySets.generate.mockResolvedValue({ id: 'qs1' });
    querySets.activate.mockImplementation((_clientId: string, querySetId: string) => {
      activeSets.push({ id: querySetId });
      return Promise.resolve({ id: querySetId, status: 'active' });
    });
    aeoAudit.create.mockResolvedValue({ id: 'a1' });
    aeoAudit.run.mockResolvedValue({ id: 'a1', status: 'completed' });
    aeoAudit.list.mockResolvedValue([]);
    competitors.discover.mockResolvedValue({});
    gapAnalysis.run.mockResolvedValue({ id: 'g1', status: 'COMPLETE' });
    reporting.generate.mockResolvedValue({ id: 'r1', status: 'RELEASED' });
    reporting.list.mockResolvedValue([{ id: 'r1' }]);
    team.sendDay1ReadyEmail.mockResolvedValue({ sent: true, kind: 'invite' });
  }

  beforeEach(async () => {
    prisma = createPrismaMock();
    queue = { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };
    discovery = { startRun: vi.fn(), getRun: vi.fn() };
    technicalAudit = { startRun: vi.fn(), getRun: vi.fn() };
    socialActivity = { startRun: vi.fn(), getRun: vi.fn(), listRuns: vi.fn() };
    querySets = { list: vi.fn(), generate: vi.fn(), activate: vi.fn() };
    aeoAudit = { create: vi.fn(), run: vi.fn(), getAudit: vi.fn(), list: vi.fn() };
    competitors = { discover: vi.fn() };
    gapAnalysis = { run: vi.fn() };
    reporting = { generate: vi.fn(), list: vi.fn() };
    team = { sendDay1ReadyEmail: vi.fn() };
    remediation = { sync: vi.fn().mockResolvedValue({ runId: 'rem1' }) };
    cloro = { getRemainingCredits: vi.fn().mockResolvedValue(10_000) };

    const configService = {
      get: vi.fn((key: string, fallback?: unknown) => {
        if (key === 'DAY1_SURFACES') return 'cloro_chatgpt';
        if (key === 'DAY1_POLL_INTERVAL_MS') return '10';
        return fallback;
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        Day1PipelineService,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: getQueueToken(DAY1_QUEUE), useValue: queue },
        { provide: ConfigService, useValue: configService },
        { provide: DiscoveryService, useValue: discovery },
        { provide: TechnicalAuditService, useValue: technicalAudit },
        { provide: SocialActivityService, useValue: socialActivity },
        { provide: QuerySetService, useValue: querySets },
        { provide: AeoAuditService, useValue: aeoAudit },
        { provide: CompetitorsService, useValue: competitors },
        { provide: GapAnalysisService, useValue: gapAnalysis },
        { provide: ReportingService, useValue: reporting },
        { provide: TeamService, useValue: team },
        { provide: RemediationSyncService, useValue: remediation },
        { provide: CloroClient, useValue: cloro },
      ],
    }).compile();

    service = moduleRef.get(Day1PipelineService);
  });

  describe('startPipeline', () => {
    it('creates the row and enqueues the job', async () => {
      prisma.day1PipelineRun.findUnique.mockResolvedValue(null);
      prisma.day1PipelineRun.create.mockResolvedValue(buildRow());

      const row = await service.startPipeline('client-1', 'project-1', { spendCeilingUsd: 25 });

      expect(prisma.day1PipelineRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ projectId: 'project-1', clientId: 'client-1', spendCeilingUsd: 25 }),
      });
      expect(queue.add).toHaveBeenCalledWith(
        'run',
        { pipelineRunId: 'pipeline-1', projectId: 'project-1', clientId: 'client-1' },
        expect.objectContaining({ jobId: 'pipeline-1' }),
      );
      expect(row.id).toBe('pipeline-1');
    });

    it('returns the existing row without duplicating when one is already there', async () => {
      prisma.day1PipelineRun.findUnique.mockResolvedValue(buildRow({ status: 'RUNNING' }));

      const row = await service.startPipeline('client-1', 'project-1', {});

      expect(row.status).toBe('RUNNING');
      expect(prisma.day1PipelineRun.create).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('still returns the row when the queue is down', async () => {
      prisma.day1PipelineRun.findUnique.mockResolvedValue(null);
      prisma.day1PipelineRun.create.mockResolvedValue(buildRow());
      queue.add.mockRejectedValueOnce(new Error('redis is down'));

      const row = await service.startPipeline('client-1', 'project-1', {});

      expect(row.id).toBe('pipeline-1');
    });

    it('does not hang when the queue never answers (Redis unreachable)', async () => {
      vi.useFakeTimers();
      try {
        prisma.day1PipelineRun.findUnique.mockResolvedValue(null);
        prisma.day1PipelineRun.create.mockResolvedValue(buildRow());
        queue.add.mockReturnValue(new Promise(() => {})); // ioredis waiting for a connection that never comes

        const pending = service.startPipeline('client-1', 'project-1', {});
        await vi.advanceTimersByTimeAsync(5_100);

        await expect(pending).resolves.toMatchObject({ id: 'pipeline-1' });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('retry', () => {
    it('answers 503 instead of hanging when the queue is unreachable', async () => {
      vi.useFakeTimers();
      try {
        prisma.day1PipelineRun.findUnique.mockResolvedValue(buildRow({ status: 'FAILED' }));
        queue.add.mockReturnValue(new Promise(() => {}));

        const pending = service.retry('client-1', 'project-1');
        const assertion = expect(pending).rejects.toThrow(ServiceUnavailableException);
        await vi.advanceTimersByTimeAsync(5_100);
        await assertion;
      } finally {
        vi.useRealTimers();
      }
    });

    it('re-enqueues a FAILED row', async () => {
      prisma.day1PipelineRun.findUnique.mockResolvedValue(buildRow({ status: 'FAILED' }));

      await service.retry('client-1', 'project-1');

      expect(queue.add).toHaveBeenCalled();
    });

    it('creates and enqueues when a legacy project has no row', async () => {
      prisma.day1PipelineRun.findUnique.mockResolvedValue(null);
      prisma.day1PipelineRun.create.mockResolvedValue(buildRow({ status: 'QUEUED' }));

      await service.retry('client-1', 'project-1');

      expect(prisma.day1PipelineRun.create).toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalled();
    });

    it('rejects COMPLETE and RUNNING rows — retrying those would double-spend', async () => {
      prisma.day1PipelineRun.findUnique.mockResolvedValue(buildRow({ status: 'COMPLETE' }));
      await expect(service.retry('client-1', 'project-1')).rejects.toThrow(ConflictException);

      prisma.day1PipelineRun.findUnique.mockResolvedValue(buildRow({ status: 'RUNNING' }));
      await expect(service.retry('client-1', 'project-1')).rejects.toThrow(ConflictException);
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('executePipeline', () => {
    it('runs every stage to COMPLETE and records the report', async () => {
      mockHappyStages();
      prisma.day1PipelineRun.findUnique.mockResolvedValue(buildRow());
      prisma.day1PipelineRun.update.mockImplementation((args: unknown) => Promise.resolve({ id: 'pipeline-1', ...(args as { data: Record<string, unknown> }).data }));

      await service.executePipeline('pipeline-1');

      expect(discovery.startRun).toHaveBeenCalledWith('project-1', 'project-created');
      expect(querySets.activate).toHaveBeenCalledWith('client-1', 'qs1');
      expect(aeoAudit.create).toHaveBeenCalledWith(
        'client-1',
        'project-1',
        expect.objectContaining({ querySetId: 'qs1', surfaces: ['cloro_chatgpt'], markets: ['US'] }),
      );
      expect(reporting.generate).toHaveBeenCalledWith('client-1', 'project-1', 'DAY1');
      expect(team.sendDay1ReadyEmail).toHaveBeenCalledWith('client-1');
      expect(remediation.sync).toHaveBeenCalledWith('client-1', 'project-1', null);

      const updates = prisma.day1PipelineRun.update.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
      const final = updates[updates.length - 1];
      expect(final.status).toBe('COMPLETE');
      expect(final.reportId).toBe('r1');
      const stages = final.stages as Record<string, { status: string; runId?: string }>;
      expect(Object.values(stages)).toHaveLength(10);
      expect(stages.remediation).toMatchObject({ status: 'completed', runId: 'rem1', finishedAt: expect.any(String) });
      expect(Object.values(stages).every((s) => s.status === 'completed')).toBe(true);
      expect(stages['aeo-audit'].runId).toBe('a1');
    });

    it('records a failed stage and still completes when the report releases', async () => {
      mockHappyStages();
      technicalAudit.getRun.mockResolvedValue({ id: 't1', status: 'FAILED' });
      prisma.day1PipelineRun.findUnique.mockResolvedValue(buildRow());
      prisma.day1PipelineRun.update.mockImplementation((args: unknown) => Promise.resolve({ id: 'pipeline-1', ...(args as { data: Record<string, unknown> }).data }));

      await service.executePipeline('pipeline-1');

      const updates = prisma.day1PipelineRun.update.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
      const final = updates[updates.length - 1];
      expect(final.status).toBe('COMPLETE');
      const stages = final.stages as Record<string, { status: string; error?: string }>;
      expect(stages['technical-audit']).toMatchObject({ status: 'failed', error: expect.stringContaining('t1') });
      // Downstream stages still ran.
      expect(reporting.generate).toHaveBeenCalled();
    });

    it('marks FAILED and rethrows when reporting itself fails', async () => {
      mockHappyStages();
      reporting.generate.mockRejectedValueOnce(new Error('db gone'));
      prisma.day1PipelineRun.findUnique.mockResolvedValue(buildRow());
      prisma.day1PipelineRun.update.mockResolvedValue(buildRow());

      await expect(service.executePipeline('pipeline-1')).rejects.toThrow('db gone');

      const updates = prisma.day1PipelineRun.update.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
      const final = updates[updates.length - 1];
      expect(final.status).toBe('FAILED');
      expect(team.sendDay1ReadyEmail).not.toHaveBeenCalled();
    });

    it('skips the query chain when generation fails, and holds the report and email because AEO did not run', async () => {
      mockHappyStages();
      querySets.generate.mockRejectedValueOnce(new ConflictException('No CompanyContextProfile exists'));
      prisma.day1PipelineRun.findUnique.mockResolvedValue(buildRow());
      prisma.day1PipelineRun.update.mockImplementation((args: unknown) => Promise.resolve({ id: 'pipeline-1', ...(args as { data: Record<string, unknown> }).data }));

      await expect(service.executePipeline('pipeline-1')).rejects.toThrow(/AEO audit did not complete/);

      expect(aeoAudit.create).not.toHaveBeenCalled();
      expect(reporting.generate).not.toHaveBeenCalled();
      expect(team.sendDay1ReadyEmail).not.toHaveBeenCalled();
      const updates = prisma.day1PipelineRun.update.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
      const final = updates[updates.length - 1];
      expect(final.status).toBe('FAILED');
      expect(String(final.error)).toContain('Report and client email held');
      const stages = final.stages as Record<string, { status: string; skippedReason?: string }>;
      expect(stages['query-set'].status).toBe('failed');
      expect(stages['aeo-audit']).toMatchObject({ status: 'skipped', skippedReason: 'no-active-query-set' });
    });

    it('skips paid stages once the ceiling is reached, and holds the report because AEO was skipped', async () => {
      mockHappyStages();
      socialActivity.listRuns.mockResolvedValue([{ totalCostUsd: 6 }]);
      prisma.day1PipelineRun.findUnique.mockResolvedValue(buildRow({ spendCeilingUsd: 5 }));
      prisma.day1PipelineRun.update.mockImplementation((args: unknown) => Promise.resolve({ id: 'pipeline-1', ...(args as { data: Record<string, unknown> }).data }));

      await expect(service.executePipeline('pipeline-1')).rejects.toThrow(/AEO audit did not complete/);

      expect(socialActivity.startRun).not.toHaveBeenCalled();
      expect(aeoAudit.create).not.toHaveBeenCalled();
      expect(reporting.generate).not.toHaveBeenCalled();
      const updates = prisma.day1PipelineRun.update.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
      const final = updates[updates.length - 1];
      expect(final.status).toBe('FAILED');
      const stages = final.stages as Record<string, { status: string; skippedReason?: string }>;
      expect(stages['social-activity'].skippedReason).toContain('spend-ceiling-reached');
      expect(stages['aeo-audit'].skippedReason).toContain('spend-ceiling-reached');
    });

    it('does not re-trigger already-recorded stages on resume', async () => {
      mockHappyStages();
      prisma.day1PipelineRun.findUnique.mockResolvedValue(
        buildRow({ status: 'FAILED', stages: { discovery: { status: 'completed', runId: 'd1' } } }),
      );
      prisma.day1PipelineRun.update.mockImplementation((args: unknown) => Promise.resolve({ id: 'pipeline-1', ...(args as { data: Record<string, unknown> }).data }));

      await service.executePipeline('pipeline-1');

      expect(discovery.startRun).not.toHaveBeenCalled();
      expect(discovery.getRun).not.toHaveBeenCalled();
      expect(technicalAudit.startRun).toHaveBeenCalled();
    });

    it('skips AEO and still completes when Cloro credits are exhausted', async () => {
      mockHappyStages();
      aeoAudit.run.mockRejectedValueOnce(new Error('Pre-flight credit estimate exceeds remaining audit budget.'));
      aeoAudit.getAudit.mockResolvedValue({
        id: 'a1',
        status: 'failed',
        surfaceRuns: [{ status: 'failed', failureKind: 'insufficient-credits', error: 'Pre-flight credit estimate exceeds remaining audit budget.' }],
      });
      cloro.getRemainingCredits.mockResolvedValue(0);
      prisma.day1PipelineRun.findUnique.mockResolvedValue(buildRow());
      prisma.day1PipelineRun.update.mockImplementation((args: unknown) => Promise.resolve({ id: 'pipeline-1', ...(args as { data: Record<string, unknown> }).data }));

      await service.executePipeline('pipeline-1');

      expect(reporting.generate).toHaveBeenCalledWith('client-1', 'project-1', 'DAY1');
      expect(team.sendDay1ReadyEmail).toHaveBeenCalled();
      const updates = prisma.day1PipelineRun.update.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
      const final = updates[updates.length - 1];
      expect(final.status).toBe('COMPLETE');
      const stages = final.stages as Record<string, { status: string; skippedReason?: string; runId?: string }>;
      expect(stages['aeo-audit'].status).toBe('skipped');
      expect(stages['aeo-audit'].skippedReason).toContain('cloro-credits-unavailable');
    });

    it('skips AEO and still completes when no Cloro key is configured', async () => {
      mockHappyStages();
      aeoAudit.run.mockRejectedValueOnce(new Error('CLORO_API_KEY is not set. Sign up at cloro.dev and add the key to run this surface.'));
      aeoAudit.getAudit.mockResolvedValue({
        id: 'a1',
        status: 'failed',
        surfaceRuns: [{ status: 'failed', failureKind: 'exception', error: 'CLORO_API_KEY is not set. Sign up at cloro.dev and add the key to run this surface.' }],
      });
      cloro.getRemainingCredits.mockRejectedValueOnce(new Error('CLORO_API_KEY is not set. Sign up at cloro.dev and add the key to run this surface.'));
      prisma.day1PipelineRun.findUnique.mockResolvedValue(buildRow());
      prisma.day1PipelineRun.update.mockImplementation((args: unknown) => Promise.resolve({ id: 'pipeline-1', ...(args as { data: Record<string, unknown> }).data }));

      await service.executePipeline('pipeline-1');

      expect(reporting.generate).toHaveBeenCalled();
      const updates = prisma.day1PipelineRun.update.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
      const final = updates[updates.length - 1];
      expect(final.status).toBe('COMPLETE');
      const stages = final.stages as Record<string, { status: string; skippedReason?: string }>;
      expect(stages['aeo-audit'].skippedReason).toContain('cloro-credits-unavailable');
    });

    it('still holds the report when AEO fails for a non-credit reason', async () => {
      mockHappyStages();
      aeoAudit.run.mockRejectedValueOnce(new Error('db connection gone'));
      aeoAudit.getAudit.mockResolvedValue({ id: 'a1', status: 'failed', surfaceRuns: [] });
      cloro.getRemainingCredits.mockResolvedValue(10_000);
      prisma.day1PipelineRun.findUnique.mockResolvedValue(buildRow());
      prisma.day1PipelineRun.update.mockImplementation((args: unknown) => Promise.resolve({ id: 'pipeline-1', ...(args as { data: Record<string, unknown> }).data }));

      await expect(service.executePipeline('pipeline-1')).rejects.toThrow(/AEO audit did not complete|db connection gone/);

      expect(reporting.generate).not.toHaveBeenCalled();
    });

    it('returns null for an unknown pipeline row', async () => {
      prisma.day1PipelineRun.findUnique.mockResolvedValue(null);

      await expect(service.executePipeline('missing')).resolves.toBeNull();
    });
  });
});
