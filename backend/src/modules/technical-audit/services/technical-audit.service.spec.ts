import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FetcherService } from '../../fetcher/fetcher.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../test/mocks/prisma.mock.js';
import { TECHNICAL_AUDIT_QUEUE } from '../queue/technical-audit.queue.js';
import { TechnicalAuditService } from './technical-audit.service.js';
import { AgentReadinessCheck } from './checks/agent-readiness.check.js';
import { CdnCheck } from './checks/cdn.check.js';
import { CwvCheck } from './checks/cwv.check.js';
import { JsRenderCheck } from './checks/js-render.check.js';
import { PageInventoryCheck } from './checks/page-inventory.check.js';
import { RobotsCheck } from './checks/robots.check.js';
import { SchemaCheck } from './checks/schema.check.js';
import { SitemapCheck } from './checks/sitemap.check.js';
import { NarrativeService } from './narrative.service.js';
import { PageMetadataService } from './page-metadata.service.js';
import type { AuditFinding } from '../technical-audit.types.js';

/**
 * The orchestrator's job is not to run checks but to decide: check order and
 * isolation, what a missing sitemap means, how the score renormalizes, and
 * which previous run a diff chains against. Those are the decisions a wrong
 * score or a corrupted diff chain comes from.
 */

function finding(overrides: Partial<AuditFinding> & { type: AuditFinding['type'] }): AuditFinding {
  return {
    status: 'pass',
    severity: 'low',
    confidence: 'confirmed',
    recommendedFix: 'ok',
    detail: {},
    ...overrides,
  };
}

describe('TechnicalAuditService', () => {
  let service: TechnicalAuditService;
  let prisma: PrismaMock;
  let queue: { add: ReturnType<typeof vi.fn> };
  let checks: Record<string, { run: ReturnType<typeof vi.fn> }>;
  let fetcher: { getLogsByRun: ReturnType<typeof vi.fn>; getRunCost: ReturnType<typeof vi.fn> };
  let narrative: { write: ReturnType<typeof vi.fn>; isAvailable?: ReturnType<typeof vi.fn> };
  let pageMetadata: { capture: ReturnType<typeof vi.fn> };

  const project = { id: 'project-1', name: 'Northwind', domain: 'northwind.io', clientId: 'client-1', deletedAt: null };

  function runRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'run-1',
      projectId: 'project-1',
      status: 'QUEUED',
      triggeredBy: 'MANUAL',
      previousAuditId: null,
      score: null,
      result: {},
      findings: [],
      deltas: [],
      narrative: null,
      narrativeModel: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      project,
      ...overrides,
    };
  }

  function passFindings(): AuditFinding[] {
    return [
      finding({ type: 'robots', detail: { robotsTxtFound: true } }),
      finding({ type: 'cdn-inferred', detail: { probes: [{}, {}], blockedBots: [] } }),
      finding({ type: 'sitemap', detail: { found: true, urlCount: 10 } }),
      finding({ type: 'js-render', detail: { contentLossPercent: 5 } }),
      finding({ type: 'cwv', detail: { performanceScore: 90 } }),
      finding({ type: 'schema' }),
      finding({ type: 'agent-readiness', detail: { score: 80 } }),
    ];
  }

  beforeEach(async () => {
    prisma = createPrismaMock();
    queue = { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };
    checks = {
      robots: { run: vi.fn() },
      cdn: { run: vi.fn() },
      sitemap: { run: vi.fn() },
      jsRender: { run: vi.fn() },
      cwv: { run: vi.fn() },
      schema: { run: vi.fn() },
      agentReadiness: { run: vi.fn() },
      pageInventory: { run: vi.fn() },
    };
    fetcher = { getLogsByRun: vi.fn().mockReturnValue([]), getRunCost: vi.fn().mockReturnValue(0) };
    narrative = { write: vi.fn().mockResolvedValue(null) };
    pageMetadata = { capture: vi.fn().mockResolvedValue({ title: 't', metaDescription: 'd', headings: [], positioningCopy: '', capturedAt: '' }) };

    // Default: every check passes; sitemap yields no entries so
    // page-inventory is the not-run skip (no Prisma needed).
    const defaults = passFindings();
    checks.robots.run.mockResolvedValue(defaults[0]);
    checks.cdn.run.mockResolvedValue(defaults[1]);
    checks.sitemap.run.mockResolvedValue({ ...defaults[2], entries: [] });
    checks.jsRender.run.mockResolvedValue(defaults[3]);
    checks.cwv.run.mockResolvedValue(defaults[4]);
    checks.schema.run.mockResolvedValue(defaults[5]);
    checks.agentReadiness.run.mockResolvedValue(defaults[6]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        TechnicalAuditService,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: ConfigService, useValue: { get: vi.fn().mockReturnValue(undefined) } },
        { provide: FetcherService, useValue: fetcher },
        { provide: getQueueToken(TECHNICAL_AUDIT_QUEUE), useValue: queue },
        { provide: RobotsCheck, useValue: checks.robots },
        { provide: CdnCheck, useValue: checks.cdn },
        { provide: SitemapCheck, useValue: checks.sitemap },
        { provide: JsRenderCheck, useValue: checks.jsRender },
        { provide: CwvCheck, useValue: checks.cwv },
        { provide: SchemaCheck, useValue: checks.schema },
        { provide: AgentReadinessCheck, useValue: checks.agentReadiness },
        { provide: PageInventoryCheck, useValue: checks.pageInventory },
        { provide: PageMetadataService, useValue: pageMetadata },
        { provide: NarrativeService, useValue: narrative },
      ],
    }).compile();

    service = moduleRef.get(TechnicalAuditService);
  });

  it('startRun returns the active run instead of starting a second concurrent one', async () => {
    const active = runRow({ status: 'RUNNING' });
    prisma.project.findFirst.mockResolvedValue(project);
    prisma.technicalAuditRun.findFirst.mockResolvedValue(active);

    const result = await service.startRun('project-1');

    expect(result).toBe(active);
    expect(prisma.technicalAuditRun.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('startRun chains previousAuditId to the most recent scored run before creating', async () => {
    prisma.project.findFirst.mockResolvedValue(project);
    prisma.technicalAuditRun.findFirst.mockResolvedValueOnce(null); // no active run
    prisma.technicalAuditRun.findFirst.mockResolvedValueOnce({ id: 'prev-1' }); // previous scored
    prisma.technicalAuditRun.create.mockResolvedValue(runRow({ id: 'run-2', previousAuditId: 'prev-1' }));

    await service.startRun('project-1');

    expect(prisma.technicalAuditRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ previousAuditId: 'prev-1' }) }),
    );
  });

  it('startRun throws 404 for an unknown project', async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(service.startRun('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('executeRun isolates a throwing check into an error finding and still completes', async () => {
    checks.cwv.run.mockRejectedValue(new Error('PSI exploded'));
    prisma.technicalAuditRun.findUnique.mockResolvedValue(runRow());
    prisma.technicalAuditRun.findFirst.mockResolvedValue(null); // no previous scored run
    prisma.technicalAuditRun.update.mockResolvedValue({});
    prisma.technicalAuditRun.findUnique.mockResolvedValueOnce(runRow());
    prisma.auditPage.createMany = prisma.auditPage.createMany ?? vi.fn();

    await service.executeRun('run-1');

    const persisted = prisma.technicalAuditRun.update.mock.calls.map((c) => c[0].data);
    const completed = persisted.find((d) => d.status === 'COMPLETE');
    expect(completed).toBeDefined();
    const findings = completed.findings as AuditFinding[];
    expect(findings.find((f) => f.type === 'cwv')?.status).toBe('error');
    // Seven other findings still recorded (robots, cdn, sitemap, js-render,
    // schema, agent-readiness, page-inventory not-run skip).
    expect(findings).toHaveLength(8);
    expect(completed.score).not.toBeNull();
  });

  it('executeRun skips page-inventory with not-run when the sitemap is empty', async () => {
    prisma.technicalAuditRun.findUnique.mockResolvedValue(runRow());
    prisma.technicalAuditRun.findFirst.mockResolvedValue(null);
    prisma.technicalAuditRun.update.mockResolvedValue({});

    await service.executeRun('run-1');

    expect(checks.pageInventory.run).not.toHaveBeenCalled();
    const completed = prisma.technicalAuditRun.update.mock.calls.map((c) => c[0].data).find((d) => d.status === 'COMPLETE');
    const pageInventory = (completed.findings as AuditFinding[]).find((f) => f.type === 'page-inventory');
    expect(pageInventory?.status).toBe('not-run');
  });

  it('executeRun is a no-op for an already-terminal run', async () => {
    prisma.technicalAuditRun.findUnique.mockResolvedValue(runRow({ status: 'COMPLETE' }));

    await service.executeRun('run-1');

    expect(checks.robots.run).not.toHaveBeenCalled();
    expect(prisma.technicalAuditRun.update).not.toHaveBeenCalled();
  });

  it('computeComposite renormalizes over whatever ran — a missing PSI component does not zero the score', async () => {
    const withCwv = service.computeComposite(
      [
        finding({ type: 'robots' }),
        finding({ type: 'cdn-inferred', detail: { probes: [{}, {}], blockedBots: [] } }),
        finding({ type: 'js-render', detail: { contentLossPercent: 0 } }),
        finding({ type: 'cwv', detail: { performanceScore: 0 } }),
      ],
      null,
      null,
    );
    const withoutCwv = service.computeComposite(
      [
        finding({ type: 'robots' }),
        finding({ type: 'cdn-inferred', detail: { probes: [{}, {}], blockedBots: [] } }),
        finding({ type: 'js-render', detail: { contentLossPercent: 0 } }),
      ],
      null,
      null,
    );
    // A 0-performance run scores lower than the same run with performance
    // absent entirely (absent is dropped, not scored as zero).
    expect(withCwv).not.toBeNull();
    expect(withoutCwv).not.toBeNull();
    expect(withoutCwv!).toBeGreaterThan(withCwv!);
  });

  it('computeComposite returns null when nothing scoreable ran', () => {
    expect(service.computeComposite([], null, null)).toBeNull();
  });
});
