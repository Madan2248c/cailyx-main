import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveVerifier } from '../verifiers/live.verifier.js';
import { asPrisma, createRemediationPrismaMock, type RemediationPrismaMock } from '../testing/prisma.fixture.js';
import { actorLabel, CLIENT_VERIFY_COOLDOWN_MS, RemediationService, toClientFix, type Viewer } from './remediation.service.js';

function fix(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fix-1',
    projectId: 'project-1',
    status: 'OPEN',
    needsClientDecision: false,
    decision: null,
    acceptance: { kind: 'robots-exists' },
    ...overrides,
  };
}

describe('RemediationService', () => {
  let prisma: RemediationPrismaMock;
  let verifier: { verify: ReturnType<typeof vi.fn> };
  let service: RemediationService;

  beforeEach(() => {
    prisma = createRemediationPrismaMock();
    verifier = { verify: vi.fn() };
    service = new RemediationService(asPrisma(prisma), verifier as unknown as LiveVerifier);
    prisma.fixSpec.update.mockImplementation(async (args: { data: unknown }) => args.data);
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1', domain: 'acme.test', name: 'Acme' });
  });

  it('404s for a fix outside the client', async () => {
    prisma.fixSpec.findFirst.mockResolvedValue(null);
    await expect(service.getFix('client-1', 'fix-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('setStatus', () => {
    it('moves along an allowed edge and records the event', async () => {
      prisma.fixSpec.findFirst.mockResolvedValue(fix());
      const out = (await service.setStatus('client-1', 'fix-1', { status: 'APPLIED', prUrl: 'https://github.com/a/b/pull/1' }, 'user-1')) as any;
      expect(out.status).toBe('APPLIED');
      expect(out.prUrl).toBe('https://github.com/a/b/pull/1');
      expect(out.events.create).toMatchObject({ kind: 'status', fromStatus: 'OPEN', toStatus: 'APPLIED', actor: 'user-1' });
    });

    it('refuses VERIFIED — only verification sets it', async () => {
      prisma.fixSpec.findFirst.mockResolvedValue(fix());
      await expect(service.setStatus('client-1', 'fix-1', { status: 'VERIFIED' }, 'u')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a forbidden edge with 409', async () => {
      prisma.fixSpec.findFirst.mockResolvedValue(fix({ status: 'VERIFIED' }));
      await expect(service.setStatus('client-1', 'fix-1', { status: 'OPEN' }, 'u')).rejects.toBeInstanceOf(ConflictException);
    });

    it('requires a reason to dismiss', async () => {
      prisma.fixSpec.findFirst.mockResolvedValue(fix());
      await expect(service.setStatus('client-1', 'fix-1', { status: 'DISMISSED' }, 'u')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reopening a decision-gated dismissal goes back to AWAITING_DECISION', async () => {
      prisma.fixSpec.findFirst.mockResolvedValue(fix({ status: 'DISMISSED', needsClientDecision: true }));
      const out = (await service.setStatus('client-1', 'fix-1', { status: 'OPEN' }, 'u')) as any;
      expect(out.status).toBe('AWAITING_DECISION');
      expect(out.dismissedReason).toBeNull();
    });
  });

  describe('decide', () => {
    it('approval opens the fix', async () => {
      prisma.fixSpec.findFirst.mockResolvedValue(fix({ status: 'AWAITING_DECISION', needsClientDecision: true }));
      const out = (await service.decide('client-1', 'fix-1', 'APPROVED', 'ok by CMO', 'u')) as any;
      expect(out).toMatchObject({ decision: 'APPROVED', status: 'OPEN', decisionNote: 'ok by CMO' });
    });

    it('decline dismisses it with the reason', async () => {
      prisma.fixSpec.findFirst.mockResolvedValue(fix({ status: 'AWAITING_DECISION', needsClientDecision: true }));
      const out = (await service.decide('client-1', 'fix-1', 'DECLINED', 'we opt out of training', 'u')) as any;
      expect(out.status).toBe('DISMISSED');
      expect(out.dismissedReason).toContain('we opt out of training');
    });

    it('rejects a decision on a fix that does not need one', async () => {
      prisma.fixSpec.findFirst.mockResolvedValue(fix());
      await expect(service.decide('client-1', 'fix-1', 'APPROVED', undefined, 'u')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('verify', () => {
    const written = () => prisma.fixSpec.update.mock.calls.at(-1)![0].data;

    it('pass → VERIFIED with the result stored', async () => {
      prisma.fixSpec.findFirst.mockResolvedValue(fix({ status: 'APPLIED' }));
      verifier.verify.mockResolvedValue({ passed: true, kind: 'robots-exists', observed: '200', checkedAt: '2026-09-28T00:00:00.000Z' });
      await service.verify('client-1', 'fix-1', 'u');
      expect(verifier.verify).toHaveBeenCalledWith({ kind: 'robots-exists' }, 'https://acme.test');
      expect(written().status).toBe('VERIFIED');
      expect(written().lastVerifiedAt).toEqual(new Date('2026-09-28T00:00:00.000Z'));
    });

    it('fail on an APPLIED fix sends it back to OPEN', async () => {
      prisma.fixSpec.findFirst.mockResolvedValue(fix({ status: 'APPLIED' }));
      verifier.verify.mockResolvedValue({ passed: false, kind: 'robots-exists', observed: '404', checkedAt: '2026-09-28T00:00:00.000Z' });
      await service.verify('client-1', 'fix-1', 'u');
      expect(written().status).toBe('OPEN');
      expect(written().lastVerifiedAt).toBeUndefined();
    });

    it('lets a client re-check only once a minute per fix', async () => {
      const client: Viewer = { sub: 'user-9', role: 'CLIENT_MEMBER', clientId: 'client-1' };
      const recent = new Date(Date.now() - CLIENT_VERIFY_COOLDOWN_MS / 2).toISOString();
      prisma.fixSpec.findFirst.mockResolvedValue(fix({ status: 'APPLIED', lastVerifyResult: { checkedAt: recent } }));
      await expect(service.verify('client-1', 'fix-1', 'user-9', client)).rejects.toMatchObject({ status: 429 });
      expect(verifier.verify).not.toHaveBeenCalled();
    });

    it('admins are never rate-limited', async () => {
      prisma.fixSpec.findFirst.mockResolvedValue(fix({ status: 'APPLIED', lastVerifyResult: { checkedAt: new Date().toISOString() } }));
      verifier.verify.mockResolvedValue({ passed: true, kind: 'robots-exists', observed: '200', checkedAt: '2026-09-28T00:00:00.000Z' });
      await service.verify('client-1', 'fix-1', 'admin-1', { sub: 'admin-1', role: 'ADMIN', clientId: null });
      expect(verifier.verify).toHaveBeenCalled();
    });

    it('409s for fixes only a newer audit can confirm', async () => {
      prisma.fixSpec.findFirst.mockResolvedValue(fix({ acceptance: { kind: 'finding-absent', module: 'technical-audit', findingRef: 'cwv' } }));
      await expect(service.verify('client-1', 'fix-1', 'u')).rejects.toBeInstanceOf(ConflictException);
      expect(verifier.verify).not.toHaveBeenCalled();
    });

    it('409s for a dismissed fix', async () => {
      prisma.fixSpec.findFirst.mockResolvedValue(fix({ status: 'DISMISSED' }));
      await expect(service.verify('client-1', 'fix-1', 'u')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('summary counts by status and class and highlights open high-severity fixes', async () => {
    const baseline = new Date('2026-09-01T00:00:00Z');
    prisma.remediationRun.findFirst.mockResolvedValue({ createdAt: baseline });
    prisma.fixSpec.findMany.mockResolvedValue([
      { status: 'OPEN', fixClass: 'CODE', severity: 'HIGH', lastVerifiedAt: null },
      { status: 'VERIFIED', fixClass: 'CODE', severity: 'HIGH', lastVerifiedAt: new Date('2026-09-20') },
      { status: 'AWAITING_DECISION', fixClass: 'CONFIG', severity: 'LOW', lastVerifiedAt: null },
      { status: 'OPEN', fixClass: 'OFF_SITE', severity: 'LOW', lastVerifiedAt: null },
    ]);
    expect(await service.summary('client-1', 'project-1')).toEqual({
      total: 4,
      byStatus: { OPEN: 2, VERIFIED: 1, AWAITING_DECISION: 1 },
      byClass: { CODE: 2, CONFIG: 1, OFF_SITE: 1 },
      openHigh: 1,
      awaitingDecision: 1,
      regressed: 0,
      verified: 1,
      verifiedSinceBaseline: 1,
      baselineAt: baseline,
    });
  });

  it('lists most severe first', async () => {
    prisma.fixSpec.findMany.mockResolvedValue([
      { severity: 'LOW', groupKey: 'a', target: 'a' },
      { severity: 'HIGH', groupKey: 'b', target: 'b' },
      { severity: 'MEDIUM', groupKey: 'a', target: 'a' },
    ]);
    const out = await service.listFixes('client-1', 'project-1');
    expect(out.map((f) => f.severity)).toEqual(['HIGH', 'MEDIUM', 'LOW']);
  });
  describe('client actions', () => {
    const client: Viewer = { sub: 'user-9', role: 'CLIENT_POC', clientId: 'client-1' };

    it('"we\'ve applied this" moves to APPLIED, records the client, then checks the site straight away', async () => {
      prisma.fixSpec.findFirst.mockResolvedValue(fix({ status: 'OPEN', events: [], llmDraft: null, draftShared: false }));
      verifier.verify.mockResolvedValue({ passed: true, kind: 'robots-exists', observed: '200', checkedAt: '2026-09-28T00:00:00.000Z' });
      prisma.user.findMany.mockResolvedValue([]);
      await service.markApplied('client-1', 'fix-1', { note: 'deployed', prUrl: 'https://github.com/a/b/pull/7' }, client);
      const first = prisma.fixSpec.update.mock.calls[0][0].data;
      expect(first.status).toBe('APPLIED');
      expect(first.prUrl).toBe('https://github.com/a/b/pull/7');
      expect(first.events.create).toMatchObject({ actor: 'user-9', toStatus: 'APPLIED', detail: { via: 'client', note: 'deployed' } });
      expect(verifier.verify).toHaveBeenCalled();
    });

    it('does not run a live check for fixes only the next audit can confirm', async () => {
      prisma.fixSpec.findFirst.mockResolvedValue(
        fix({ status: 'OPEN', events: [], llmDraft: null, draftShared: false, acceptance: { kind: 'finding-absent', module: 'technical-audit', findingRef: 'cwv' } }),
      );
      prisma.user.findMany.mockResolvedValue([]);
      await service.markApplied('client-1', 'fix-1', {}, client);
      expect(verifier.verify).not.toHaveBeenCalled();
    });

    it('refuses to mark a verified or dismissed fix as applied', async () => {
      prisma.fixSpec.findFirst.mockResolvedValue(fix({ status: 'VERIFIED' }));
      await expect(service.markApplied('client-1', 'fix-1', {}, client)).rejects.toBeInstanceOf(ConflictException);
      prisma.fixSpec.findFirst.mockResolvedValue(fix({ status: 'DISMISSED' }));
      await expect(service.markApplied('client-1', 'fix-1', {}, client)).rejects.toBeInstanceOf(ConflictException);
    });

    it('sharing a draft needs a draft', async () => {
      prisma.fixSpec.findFirst.mockResolvedValue(fix({ llmDraft: null }));
      await expect(service.setDraftShared('client-1', 'fix-1', true, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
      prisma.fixSpec.findFirst.mockResolvedValue(fix({ llmDraft: { kind: 'meta' } }));
      const out = (await service.setDraftShared('client-1', 'fix-1', true, 'admin-1')) as any;
      expect(out.draftShared).toBe(true);
    });
  });

  describe('client-safe view', () => {
    const viewer: Viewer = { sub: 'user-9', role: 'CLIENT_MEMBER', clientId: 'client-1' };

    it('hides an unshared LLM draft and shows a shared one', () => {
      expect(toClientFix({ llmDraft: { kind: 'meta' }, draftShared: false }, viewer, new Map()).llmDraft).toBeNull();
      expect(toClientFix({ llmDraft: { kind: 'meta' }, draftShared: true }, viewer, new Map()).llmDraft).toEqual({ kind: 'meta' });
    });

    it('labels history by who, never by internal id', () => {
      const actors = new Map([
        ['admin-1', { role: 'ADMIN', clientId: null }],
        ['user-2', { role: 'CLIENT_POC', clientId: 'client-1' }],
        ['user-x', { role: 'CLIENT_POC', clientId: 'other' }],
      ]);
      const out = toClientFix(
        { llmDraft: null, draftShared: false, events: [{ actor: 'system' }, { actor: 'user-9' }, { actor: 'user-2' }, { actor: 'admin-1' }, { actor: 'user-x' }] },
        viewer,
        actors,
      );
      expect(out.events!.map((e) => e.actor)).toEqual(['Automatic check', 'You', 'Your team', 'Rothenhall', 'Rothenhall']);
    });

    it('actorLabel treats unknown ids as Rothenhall, never leaking them', () => {
      expect(actorLabel('0a1b-unknown', viewer)).toBe('Rothenhall');
    });

    it("a client's live check returns the client view: no unshared draft (regression)", async () => {
      prisma.fixSpec.findFirst.mockResolvedValue(
        fix({ status: 'APPLIED', events: [], llmDraft: { kind: 'meta' }, draftShared: false, lastVerifyResult: null }),
      );
      prisma.user.findMany.mockResolvedValue([]);
      verifier.verify.mockResolvedValue({ passed: true, kind: 'robots-exists', observed: '200', checkedAt: '2026-09-28T00:00:00.000Z' });
      const out = (await service.verify('client-1', 'fix-1', 'user-9', viewer)) as any;
      expect(out.llmDraft).toBeNull();
    });

    it('getFixFor returns the raw record to admins', async () => {
      prisma.fixSpec.findFirst.mockResolvedValue(fix({ events: [{ actor: 'admin-1' }], llmDraft: { kind: 'meta' }, draftShared: false }));
      const out = (await service.getFixFor('client-1', 'fix-1', { sub: 'admin-1', role: 'ADMIN', clientId: null })) as any;
      expect(out.llmDraft).toEqual({ kind: 'meta' });
      expect(out.events[0].actor).toBe('admin-1');
    });
  });
});
