import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceSnapshotCollector } from '../collectors/source-snapshot.collector.js';
import { asPrisma, createRemediationPrismaMock, type RemediationPrismaMock } from '../testing/prisma.fixture.js';
import { SITE, snapshot, TA_RUN } from '../testing/snapshot.fixture.js';
import { fingerprint, linkedGapRecommendation, mergeDrafts, RemediationSyncService } from './remediation-sync.service.js';

const project = { id: 'project-1', clientId: 'client-1', name: 'Acme', domain: 'acme.test', deletedAt: null };

describe('RemediationSyncService', () => {
  let prisma: RemediationPrismaMock;
  let collector: { collect: ReturnType<typeof vi.fn> };
  let service: RemediationSyncService;

  beforeEach(() => {
    prisma = createRemediationPrismaMock();
    collector = { collect: vi.fn() };
    service = new RemediationSyncService(asPrisma(prisma), collector as unknown as SourceSnapshotCollector);
    prisma.project.findFirst.mockResolvedValue(project);
    prisma.remediationRun.create.mockResolvedValue({ id: 'run-1' });
    prisma.fixSpec.findMany.mockResolvedValue([]);
  });

  it('404s for a project outside the client', async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(service.sync('client-1', 'project-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409s when no source audit has completed — never invents fixes', async () => {
    collector.collect.mockResolvedValue(snapshot({ technicalAudit: null, socialActivity: null, aeoAudit: null }));
    await expect(service.sync('client-1', 'project-1', 'user-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.remediationRun.create).not.toHaveBeenCalled();
  });

  it('creates one spec per problem, with decision-gated ones AWAITING_DECISION, and links Gap Analysis', async () => {
    collector.collect.mockResolvedValue(snapshot());
    const out = await service.sync('client-1', 'project-1', 'user-1');

    const created = prisma.fixSpec.create.mock.calls.map((c) => c[0].data);
    expect(out.created).toBe(created.length);
    expect(out.created).toBeGreaterThan(5);
    const training = created.find((d) => d.problemKey === 'robots.training-crawlers-blocked');
    expect(training.status).toBe('AWAITING_DECISION');
    const unblock = created.find((d) => d.problemKey === 'robots.unblock-ai-crawlers');
    expect(unblock.status).toBe('OPEN');
    expect(unblock.gapRecommendationId).toBe('rec-1');
    expect(unblock.fingerprint).toBe(fingerprint('project-1', 'robots.unblock-ai-crawlers', SITE));
    expect(unblock.events.create.kind).toBe('sync');

    const runUpdate = prisma.remediationRun.update.mock.calls.at(-1)![0].data;
    expect(runUpdate.status).toBe('COMPLETE');
    expect(runUpdate.createdCount).toBe(out.created);
  });

  it('is idempotent: a re-sync of the same data updates rows and never changes status', async () => {
    const s = snapshot();
    collector.collect.mockResolvedValue(s);
    await service.sync('client-1', 'project-1', 'user-1');
    const createdRows = prisma.fixSpec.create.mock.calls.map((c, i) => ({
      id: `fix-${i}`,
      fingerprint: c[0].data.fingerprint,
      status: 'IN_PROGRESS',
      lastReportedAt: c[0].data.lastReportedAt,
      lastVerifiedAt: null,
      problemKey: c[0].data.problemKey,
      target: c[0].data.target,
      sources: c[0].data.sources.create,
    }));
    prisma.fixSpec.create.mockClear();
    prisma.fixSpec.findMany.mockResolvedValue(createdRows);

    const out = await service.sync('client-1', 'project-1', 'user-1');
    expect(out.created).toBe(0);
    expect(out.updated).toBe(createdRows.length);
    expect(out.verified).toBe(0);
    for (const call of prisma.fixSpec.update.mock.calls) expect(call[0].data.status).toBe('IN_PROGRESS');
  });

  it('a VERIFIED fix reported again by a NEWER run becomes REGRESSED', async () => {
    const s = snapshot();
    collector.collect.mockResolvedValue(s);
    const fp = fingerprint('project-1', 'robots.unblock-ai-crawlers', SITE);
    prisma.fixSpec.findMany.mockResolvedValue([
      { id: 'fix-1', fingerprint: fp, status: 'VERIFIED', lastReportedAt: new Date('2026-09-01'), lastVerifiedAt: new Date('2026-09-10'), problemKey: 'robots.unblock-ai-crawlers', target: SITE, sources: [] },
    ]);
    const out = await service.sync('client-1', 'project-1', 'user-1');
    expect(out.regressed).toBe(1);
    const update = prisma.fixSpec.update.mock.calls.find((c) => c[0].where.id === 'fix-1')![0].data;
    expect(update.status).toBe('REGRESSED');
    expect(update.events.create.toStatus).toBe('REGRESSED');
  });

  it('a VERIFIED fix still listed by the SAME older run stays VERIFIED', async () => {
    collector.collect.mockResolvedValue(snapshot());
    const fp = fingerprint('project-1', 'robots.unblock-ai-crawlers', SITE);
    prisma.fixSpec.findMany.mockResolvedValue([
      { id: 'fix-1', fingerprint: fp, status: 'VERIFIED', lastReportedAt: new Date('2026-09-20T10:00:00Z'), lastVerifiedAt: new Date('2026-09-25'), problemKey: 'robots.unblock-ai-crawlers', target: SITE, sources: [] },
    ]);
    const out = await service.sync('client-1', 'project-1', 'user-1');
    expect(out.regressed).toBe(0);
  });

  it('an open fix no longer reported by a newer run that looked is VERIFIED by the next audit', async () => {
    collector.collect.mockResolvedValue(snapshot());
    prisma.fixSpec.findMany.mockResolvedValue([
      {
        id: 'fix-old',
        fingerprint: fingerprint('project-1', 'robots.missing', SITE),
        status: 'APPLIED',
        lastReportedAt: new Date('2026-09-01'),
        lastVerifiedAt: null,
        problemKey: 'robots.missing',
        target: SITE,
        sources: [{ module: 'technical-audit', findingRef: 'robots', runId: 'older' }],
      },
    ]);
    const out = await service.sync('client-1', 'project-1', 'user-1');
    expect(out.verified).toBe(1);
    const update = prisma.fixSpec.update.mock.calls.find((c) => c[0].where.id === 'fix-old')![0].data;
    expect(update.status).toBe('VERIFIED');
    expect(update.lastVerifyResult.kind).toBe('finding-absent');
  });

  it('a fix for a page not crawled this time is left alone', async () => {
    collector.collect.mockResolvedValue(snapshot());
    prisma.fixSpec.findMany.mockResolvedValue([
      {
        id: 'fix-page',
        fingerprint: 'x',
        status: 'OPEN',
        lastReportedAt: new Date('2026-09-01'),
        lastVerifiedAt: null,
        problemKey: 'page.meta-missing',
        target: `${SITE}/blog/uncrawled`,
        sources: [{ module: 'technical-audit', findingRef: 'page-inventory', runId: 'older' }],
      },
    ]);
    const out = await service.sync('client-1', 'project-1', 'user-1');
    expect(out.verified).toBe(0);
  });

  it('marks the run FAILED and rethrows when persistence fails', async () => {
    collector.collect.mockResolvedValue(snapshot());
    prisma.fixSpec.create.mockRejectedValue(new Error('db down'));
    await expect(service.sync('client-1', 'project-1', 'user-1')).rejects.toThrow('db down');
    expect(prisma.remediationRun.update.mock.calls.at(-1)![0].data).toMatchObject({ status: 'FAILED', error: 'db down' });
  });
});

describe('sync helpers', () => {
  it('fingerprint is stable and distinguishes targets', () => {
    expect(fingerprint('p', 'k', 'a')).toBe(fingerprint('p', 'k', 'a'));
    expect(fingerprint('p', 'k', 'a')).not.toBe(fingerprint('p', 'k', 'b'));
  });

  it('mergeDrafts keeps one spec per fingerprint with every distinct source', () => {
    const base = { problemKey: 'k', target: 't', fixClass: 'CODE', method: 'INSTRUCTIONS', groupKey: 'g', severity: 'LOW', effort: 'LOW', title: 'x', evidence: {}, acceptance: { kind: 'robots-exists' } } as const;
    const merged = mergeDrafts('p', [
      { ...base, steps: ['s'], sources: [{ module: 'technical-audit', runId: TA_RUN, findingRef: 'a' }] },
      { ...base, steps: ['s'], sources: [{ module: 'technical-audit', runId: TA_RUN, findingRef: 'a' }, { module: 'technical-audit', runId: TA_RUN, findingRef: 'b' }] },
    ]);
    expect(merged.size).toBe(1);
    expect([...merged.values()][0].sources.map((s) => s.findingRef)).toEqual(['a', 'b']);
  });

  it('links to no Gap Analysis recommendation when none cites the finding', () => {
    expect(linkedGapRecommendation([{ module: 'social-activity', runId: 'r', findingRef: 'x:y' }], snapshot())).toBeNull();
  });
});
