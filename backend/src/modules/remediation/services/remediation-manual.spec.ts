import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveVerifier } from '../verifiers/live.verifier.js';
import { asPrisma, createRemediationPrismaMock, type RemediationPrismaMock } from '../testing/prisma.fixture.js';
import { isManualFix, MANUAL_PROBLEM_KEY, RemediationService } from './remediation.service.js';

const input = {
  title: 'Add a returns policy page',
  target: 'https://acme.test/returns',
  fixClass: 'CONTENT' as const,
  severity: 'HIGH' as const,
  effort: 'LOW' as const,
  steps: ['  Draft the policy ', '', 'Publish at /returns'],
};

function manualFix(overrides: Record<string, unknown> = {}) {
  return { id: 'fix-1', projectId: 'project-1', status: 'APPLIED', problemKey: MANUAL_PROBLEM_KEY, needsClientDecision: false, decision: null, acceptance: { kind: 'manual' }, ...overrides };
}

describe('manual fixes', () => {
  let prisma: RemediationPrismaMock;
  let verifier: { verify: ReturnType<typeof vi.fn> };
  let service: RemediationService;

  beforeEach(() => {
    prisma = createRemediationPrismaMock();
    verifier = { verify: vi.fn() };
    service = new RemediationService(asPrisma(prisma), verifier as unknown as LiveVerifier);
    prisma.fixSpec.create.mockImplementation(async (args: { data: unknown }) => args.data);
    prisma.fixSpec.update.mockImplementation(async (args: { data: unknown }) => args.data);
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
  });

  it('creates an OPEN, human-method fix with no sources and a manual acceptance check', async () => {
    const out = (await service.createManualFix('client-1', 'project-1', input, 'admin-1')) as any;
    expect(out).toMatchObject({ problemKey: MANUAL_PROBLEM_KEY, method: 'HUMAN', status: 'OPEN', groupKey: 'manual', acceptance: { kind: 'manual' } });
    expect(out.steps).toEqual(['Draft the policy', 'Publish at /returns']);
    expect(out.sources).toBeUndefined();
    expect(out.events.create).toMatchObject({ kind: 'status', toStatus: 'OPEN', actor: 'admin-1' });
  });

  it('gives every manual fix its own fingerprint, so two identical fixes never collide', async () => {
    const a = (await service.createManualFix('client-1', 'project-1', input, 'admin-1')) as any;
    const b = (await service.createManualFix('client-1', 'project-1', input, 'admin-1')) as any;
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it('starts AWAITING_DECISION when the client must approve first', async () => {
    const out = (await service.createManualFix('client-1', 'project-1', { ...input, needsClientDecision: true }, 'admin-1')) as any;
    expect(out.status).toBe('AWAITING_DECISION');
    expect(out.needsClientDecision).toBe(true);
  });

  it('404s for a project outside the client', async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(service.createManualFix('client-1', 'other', input, 'admin-1')).rejects.toThrow('Project not found');
  });

  it('lets an admin confirm a manual fix as VERIFIED, recording who and why', async () => {
    prisma.fixSpec.findFirst.mockResolvedValue(manualFix());
    const out = (await service.setStatus('client-1', 'fix-1', { status: 'VERIFIED', note: 'Checked live' }, 'admin-1')) as any;
    expect(out.status).toBe('VERIFIED');
    expect(out.lastVerifyResult).toMatchObject({ passed: true, kind: 'manual', observed: 'Checked live' });
    expect(out.events.create).toMatchObject({ kind: 'verify', fromStatus: 'APPLIED', toStatus: 'VERIFIED', actor: 'admin-1' });
  });

  it('still refuses VERIFIED on an audit-found fix', async () => {
    prisma.fixSpec.findFirst.mockResolvedValue(manualFix({ problemKey: 'robots.unblock-ai-crawlers', acceptance: { kind: 'robots-exists' } }));
    await expect(service.setStatus('client-1', 'fix-1', { status: 'VERIFIED' }, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets an admin reopen a verified manual fix, but not a verified audit fix', async () => {
    prisma.fixSpec.findFirst.mockResolvedValue(manualFix({ status: 'VERIFIED' }));
    const out = (await service.setStatus('client-1', 'fix-1', { status: 'OPEN' }, 'admin-1')) as any;
    expect(out.status).toBe('OPEN');

    prisma.fixSpec.findFirst.mockResolvedValue(manualFix({ status: 'VERIFIED', problemKey: 'robots.unblock-ai-crawlers' }));
    await expect(service.setStatus('client-1', 'fix-1', { status: 'OPEN' }, 'admin-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('explains that a manual fix has no automatic check instead of pretending to verify it', async () => {
    prisma.fixSpec.findFirst.mockResolvedValue(manualFix());
    await expect(service.verify('client-1', 'fix-1', 'admin-1')).rejects.toThrow('added by hand');
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('deletes a manual fix', async () => {
    prisma.fixSpec.findFirst.mockResolvedValue(manualFix());
    await expect(service.deleteManualFix('client-1', 'fix-1')).resolves.toEqual({ success: true });
    expect(prisma.fixSpec.delete).toHaveBeenCalledWith({ where: { id: 'fix-1' } });
  });

  it('refuses to delete an audit-found fix, pointing at dismiss', async () => {
    prisma.fixSpec.findFirst.mockResolvedValue(manualFix({ problemKey: 'page.meta-missing' }));
    await expect(service.deleteManualFix('client-1', 'fix-1')).rejects.toThrow(/Dismiss/);
    expect(prisma.fixSpec.delete).not.toHaveBeenCalled();
  });

  it('isManualFix keys off the problem key', () => {
    expect(isManualFix({ problemKey: MANUAL_PROBLEM_KEY })).toBe(true);
    expect(isManualFix({ problemKey: 'page.meta-missing' })).toBe(false);
  });
});
