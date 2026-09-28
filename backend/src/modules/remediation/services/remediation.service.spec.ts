import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveVerifier } from '../verifiers/live.verifier.js';
import { asPrisma, createRemediationPrismaMock, type RemediationPrismaMock } from '../testing/prisma.fixture.js';
import { RemediationService } from './remediation.service.js';

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
    it('pass → VERIFIED with the result stored', async () => {
      prisma.fixSpec.findFirst.mockResolvedValue(fix({ status: 'APPLIED' }));
      verifier.verify.mockResolvedValue({ passed: true, kind: 'robots-exists', observed: '200', checkedAt: '2026-09-28T00:00:00.000Z' });
      const out = (await service.verify('client-1', 'fix-1', 'u')) as any;
      expect(verifier.verify).toHaveBeenCalledWith({ kind: 'robots-exists' }, 'https://acme.test');
      expect(out.status).toBe('VERIFIED');
      expect(out.lastVerifiedAt).toEqual(new Date('2026-09-28T00:00:00.000Z'));
    });

    it('fail on an APPLIED fix sends it back to OPEN', async () => {
      prisma.fixSpec.findFirst.mockResolvedValue(fix({ status: 'APPLIED' }));
      verifier.verify.mockResolvedValue({ passed: false, kind: 'robots-exists', observed: '404', checkedAt: '2026-09-28T00:00:00.000Z' });
      const out = (await service.verify('client-1', 'fix-1', 'u')) as any;
      expect(out.status).toBe('OPEN');
      expect(out.lastVerifiedAt).toBeUndefined();
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
    prisma.fixSpec.findMany.mockResolvedValue([
      { status: 'OPEN', fixClass: 'CODE', severity: 'HIGH' },
      { status: 'VERIFIED', fixClass: 'CODE', severity: 'HIGH' },
      { status: 'OPEN', fixClass: 'OFF_SITE', severity: 'LOW' },
    ]);
    expect(await service.summary('client-1', 'project-1')).toEqual({
      total: 3,
      byStatus: { OPEN: 2, VERIFIED: 1 },
      byClass: { CODE: 2, OFF_SITE: 1 },
      openHigh: 1,
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
});
