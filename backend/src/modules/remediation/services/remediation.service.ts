/**
 * Remediation reads and the manual half of the status machine: list/get
 * fixes, move status, record a client decision, run a live verification,
 * summarise and export. Sync lives in `RemediationSyncService`; LLM drafts in
 * `RemediationDraftService`.
 *
 * Every change is written to `fix_spec_events` in the same statement as the
 * spec update, so the history can never disagree with the current row.
 *
 * @module remediation/services/remediation.service
 */

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { FixClass, FixStatus } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { siteOrigin } from '../collectors/source-snapshot.collector.js';
import type { AcceptanceCheck } from '../remediation.types.js';
import { isLiveCheckable, LiveVerifier } from '../verifiers/live.verifier.js';
import { renderFixPackMarkdown, toFixPackJson } from './fix-pack.js';
import { afterFailedVerify, canMove, reopenTarget, VERIFIABLE } from './fix-status.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
function asJson(value: unknown): any {
  return JSON.parse(JSON.stringify(value ?? null)) as any;
}

export interface FixListFilter {
  status?: FixStatus[];
  fixClass?: FixClass;
  groupKey?: string;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface StatusChange {
  status: FixStatus;
  reason?: string;
  prUrl?: string;
  note?: string;
}

const SEVERITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

@Injectable()
export class RemediationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly verifier: LiveVerifier,
  ) {}

  // ─── Runs ─────────────────────────────────────────────────────────────

  async listRuns(clientId: string, projectId: string) {
    await this.assertProjectInClient(projectId, clientId);
    return this.prisma.remediationRun.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  async getRun(clientId: string, runId: string) {
    const run = await this.prisma.remediationRun.findFirst({ where: { id: runId, project: { clientId, deletedAt: null } } });
    if (!run) throw new NotFoundException('Run not found.');
    return run;
  }

  // ─── Fixes ────────────────────────────────────────────────────────────

  /** Severity first (high → low), then group, then target — the order someone works through them. */
  async listFixes(clientId: string, projectId: string, filter: FixListFilter = {}) {
    await this.assertProjectInClient(projectId, clientId);
    const rows = await this.prisma.fixSpec.findMany({
      where: {
        projectId,
        ...(filter.status?.length ? { status: { in: filter.status } } : {}),
        ...(filter.fixClass ? { fixClass: filter.fixClass } : {}),
        ...(filter.groupKey ? { groupKey: filter.groupKey } : {}),
        ...(filter.severity ? { severity: filter.severity } : {}),
      },
      include: { sources: true },
    });
    return rows.sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.groupKey.localeCompare(b.groupKey) || a.target.localeCompare(b.target),
    );
  }

  async getFix(clientId: string, fixId: string) {
    const fix = await this.prisma.fixSpec.findFirst({
      where: { id: fixId, project: { clientId, deletedAt: null } },
      include: { sources: true, events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!fix) throw new NotFoundException('Fix not found.');
    return fix;
  }

  async setStatus(clientId: string, fixId: string, change: StatusChange, actorId: string) {
    const fix = await this.getFix(clientId, fixId);
    if (change.status === 'VERIFIED') throw new BadRequestException('VERIFIED is set only by verification — use POST …/verify.');
    if (!canMove(fix.status, change.status)) {
      throw new ConflictException(`Cannot move a fix from ${fix.status} to ${change.status}.`);
    }
    if (change.status === 'DISMISSED' && !change.reason?.trim()) throw new BadRequestException('A reason is required to dismiss a fix.');

    // Reopening something that still needs the client's say goes back to waiting for it.
    const to = fix.status === 'DISMISSED' && change.status === 'OPEN' ? reopenTarget(fix.needsClientDecision, fix.decision) : change.status;

    return this.prisma.fixSpec.update({
      where: { id: fix.id },
      data: {
        status: to,
        ...(to === 'DISMISSED' ? { dismissedReason: change.reason!.trim() } : {}),
        ...(fix.status === 'DISMISSED' ? { dismissedReason: null } : {}),
        ...(change.prUrl ? { prUrl: change.prUrl } : {}),
        events: {
          create: {
            kind: 'status',
            fromStatus: fix.status,
            toStatus: to,
            actor: actorId,
            detail: asJson({ reason: change.reason ?? null, prUrl: change.prUrl ?? null, note: change.note ?? null }),
          },
        },
      },
      include: { sources: true },
    });
  }

  /** Records the client's call on a fix that needs one (staff record it on the client's behalf in v1). */
  async decide(clientId: string, fixId: string, decision: 'APPROVED' | 'DECLINED', note: string | undefined, actorId: string) {
    const fix = await this.getFix(clientId, fixId);
    if (!fix.needsClientDecision) throw new BadRequestException('This fix does not need a client decision.');
    if (fix.status !== 'AWAITING_DECISION') throw new ConflictException(`Fix is ${fix.status}, not awaiting a decision.`);
    const to: FixStatus = decision === 'APPROVED' ? 'OPEN' : 'DISMISSED';
    return this.prisma.fixSpec.update({
      where: { id: fix.id },
      data: {
        decision,
        decisionNote: note?.trim() || null,
        status: to,
        ...(to === 'DISMISSED' ? { dismissedReason: `Client declined${note?.trim() ? `: ${note.trim()}` : '.'}` } : {}),
        events: { create: { kind: 'decision', fromStatus: fix.status, toStatus: to, actor: actorId, detail: asJson({ decision, note: note ?? null }) } },
      },
      include: { sources: true },
    });
  }

  /**
   * Re-checks the live site. Pass → VERIFIED. Fail → an APPLIED fix goes back
   * to OPEN; anything else stays put. Either way the result is recorded.
   */
  async verify(clientId: string, fixId: string, actorId: string) {
    const fix = await this.getFix(clientId, fixId);
    if (!VERIFIABLE.includes(fix.status)) throw new ConflictException(`A ${fix.status} fix cannot be verified.`);
    const check = fix.acceptance as unknown as AcceptanceCheck;
    if (!isLiveCheckable(check)) {
      throw new ConflictException('This fix is verified by the next audit, not a live check: re-run the source audit, then sync.');
    }

    const project = await this.prisma.project.findFirst({ where: { id: fix.projectId }, select: { domain: true } });
    const result = await this.verifier.verify(check, siteOrigin(project!.domain));
    const to: FixStatus = result.passed ? 'VERIFIED' : afterFailedVerify(fix.status);

    return this.prisma.fixSpec.update({
      where: { id: fix.id },
      data: {
        status: to,
        lastVerifyResult: asJson(result),
        ...(result.passed ? { lastVerifiedAt: new Date(result.checkedAt) } : {}),
        events: { create: { kind: 'verify', fromStatus: fix.status, toStatus: to, actor: actorId, detail: asJson(result) } },
      },
      include: { sources: true },
    });
  }

  // ─── Summary + export ─────────────────────────────────────────────────

  /** Counts for a dashboard or a report section. */
  async summary(clientId: string, projectId: string) {
    await this.assertProjectInClient(projectId, clientId);
    const rows = await this.prisma.fixSpec.findMany({ where: { projectId }, select: { status: true, fixClass: true, severity: true } });
    const byStatus: Record<string, number> = {};
    const byClass: Record<string, number> = {};
    let openHigh = 0;
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      byClass[r.fixClass] = (byClass[r.fixClass] ?? 0) + 1;
      if (r.severity === 'HIGH' && (r.status === 'OPEN' || r.status === 'REGRESSED' || r.status === 'IN_PROGRESS')) openHigh++;
    }
    return { total: rows.length, byStatus, byClass, openHigh };
  }

  /** Every non-dismissed fix, as Markdown for a developer/agency or JSON for an agent. */
  async exportFixPack(clientId: string, projectId: string, format: 'md' | 'json') {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null } });
    if (!project) throw new NotFoundException('Project not found.');
    const fixes = (await this.listFixes(clientId, projectId)).filter((f) => f.status !== 'DISMISSED');
    const pack = toFixPackJson(project, fixes);
    return format === 'json' ? pack : renderFixPackMarkdown(pack);
  }

  private async assertProjectInClient(projectId: string, clientId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundException('Project not found.');
  }
}
