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

import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { AccessTokenPayload } from '../../../common/jwt/access-token-payload.js';
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

/** Who is looking. Admins see everything; client users get the client-safe view. */
export type Viewer = Pick<AccessTokenPayload, 'sub' | 'role' | 'clientId'>;

/** Statuses a client may mark as applied (their developer did the work). */
const CLIENT_APPLICABLE: readonly FixStatus[] = ['OPEN', 'IN_PROGRESS', 'REGRESSED'];

/** One live re-check per fix per minute for client users: it fetches their site, cheap but not a loop. */
export const CLIENT_VERIFY_COOLDOWN_MS = 60_000;

export interface ClientApplied {
  note?: string;
  prUrl?: string;
}

function isClient(viewer?: Viewer): viewer is Viewer {
  return !!viewer && viewer.role !== 'ADMIN';
}

/** Client-safe view: unreviewed drafts hidden until staff share them; history shows who, not internal ids. */
export function toClientFix<T extends { llmDraft: unknown; draftShared: boolean; events?: Array<{ actor: string }> }>(
  fix: T,
  viewer: Viewer,
  actors: Map<string, { role: string; clientId: string | null }>,
) {
  const { events, ...rest } = fix;
  return {
    ...rest,
    llmDraft: fix.draftShared ? fix.llmDraft : null,
    ...(events
      ? {
          events: events.map(({ actor, ...e }) => ({
            ...e,
            actor: actorLabel(actor, viewer, actors.get(actor)),
          })),
        }
      : {}),
  };
}

export function actorLabel(actor: string, viewer: Viewer, who?: { role: string; clientId: string | null }): string {
  if (actor === 'system') return 'Automatic check';
  if (actor === viewer.sub) return 'You';
  if (who && who.role !== 'ADMIN' && who.clientId && who.clientId === viewer.clientId) return 'Your team';
  return 'Rothenhall';
}

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
  async listFixes(clientId: string, projectId: string, filter: FixListFilter = {}, viewer?: Viewer) {
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
    const sorted = rows.sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.groupKey.localeCompare(b.groupKey) || a.target.localeCompare(b.target),
    );
    return isClient(viewer) ? sorted.map((f) => toClientFix(f, viewer, new Map())) : sorted;
  }

  /** One fix with its sources and history, shaped for whoever is asking. */
  async getFixFor(clientId: string, fixId: string, viewer?: Viewer) {
    const fix = await this.getFix(clientId, fixId);
    if (!isClient(viewer)) return fix;
    const ids = [...new Set(fix.events.map((e) => e.actor).filter((a) => a !== 'system'))];
    const users = ids.length
      ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, role: true, clientId: true } })
      : [];
    return toClientFix(fix, viewer, new Map(users.map((u) => [u.id, { role: u.role, clientId: u.clientId }])));
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
    if (change.status === 'VERIFIED') throw new BadRequestException('VERIFIED is set only by verification. Use POST …/verify.');
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
  async decide(clientId: string, fixId: string, decision: 'APPROVED' | 'DECLINED', note: string | undefined, actorId: string, viewer?: Viewer) {
    const fix = await this.getFix(clientId, fixId);
    if (!fix.needsClientDecision) throw new BadRequestException('This fix does not need a client decision.');
    if (fix.status !== 'AWAITING_DECISION') throw new ConflictException(`Fix is ${fix.status}, not awaiting a decision.`);
    const to: FixStatus = decision === 'APPROVED' ? 'OPEN' : 'DISMISSED';
    const updated = await this.prisma.fixSpec.update({
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
    return isClient(viewer) ? this.getFixFor(clientId, fix.id, viewer) : updated;
  }

  /**
   * Re-checks the live site. Pass → VERIFIED. Fail → an APPLIED fix goes back
   * to OPEN; anything else stays put. Either way the result is recorded.
   */
  async verify(clientId: string, fixId: string, actorId: string, viewer?: Viewer) {
    const fix = await this.getFix(clientId, fixId);
    if (!VERIFIABLE.includes(fix.status)) throw new ConflictException(`A ${fix.status} fix cannot be verified.`);
    if (isClient(viewer)) {
      const last = (fix.lastVerifyResult as { checkedAt?: string } | null)?.checkedAt;
      if (last && Date.now() - new Date(last).getTime() < CLIENT_VERIFY_COOLDOWN_MS) {
        throw new HttpException('This fix was just checked. Try again in a minute.', HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    const check = fix.acceptance as unknown as AcceptanceCheck;
    if (!isLiveCheckable(check)) {
      throw new ConflictException('This fix is verified by the next audit, not a live check: re-run the source audit, then sync.');
    }

    const project = await this.prisma.project.findFirst({ where: { id: fix.projectId }, select: { domain: true } });
    const result = await this.verifier.verify(check, siteOrigin(project!.domain));
    const to: FixStatus = result.passed ? 'VERIFIED' : afterFailedVerify(fix.status);

    await this.prisma.fixSpec.update({
      where: { id: fix.id },
      data: {
        status: to,
        lastVerifyResult: asJson(result),
        ...(result.passed ? { lastVerifiedAt: new Date(result.checkedAt) } : {}),
        events: { create: { kind: 'verify', fromStatus: fix.status, toStatus: to, actor: actorId, detail: asJson(result) } },
      },
    });
    return this.getFixFor(clientId, fix.id, viewer);
  }

  /**
   * The client's "we've applied this": their developer shipped the fix. Moves
   * it to APPLIED and, when the fix has a live acceptance check, checks the
   * site straight away so the client sees the result without waiting for the
   * next audit. Clients never get the general status endpoint.
   */
  async markApplied(clientId: string, fixId: string, input: ClientApplied, viewer: Viewer) {
    const fix = await this.getFix(clientId, fixId);
    if (!CLIENT_APPLICABLE.includes(fix.status)) {
      throw new ConflictException(`A ${fix.status.toLowerCase().replace('_', ' ')} fix cannot be marked as applied.`);
    }
    await this.prisma.fixSpec.update({
      where: { id: fix.id },
      data: {
        status: 'APPLIED',
        ...(input.prUrl ? { prUrl: input.prUrl } : {}),
        events: {
          create: {
            kind: 'status',
            fromStatus: fix.status,
            toStatus: 'APPLIED',
            actor: viewer.sub,
            detail: asJson({ note: input.note?.trim() || null, prUrl: input.prUrl ?? null, via: 'client' }),
          },
        },
      },
    });
    if (isLiveCheckable(fix.acceptance as unknown as AcceptanceCheck)) {
      await this.verify(clientId, fix.id, 'system');
    }
    return this.getFixFor(clientId, fix.id, viewer);
  }

  /** Staff decide whether a drafted rewrite is ready for the client to see. */
  async setDraftShared(clientId: string, fixId: string, shared: boolean, actorId: string) {
    const fix = await this.getFix(clientId, fixId);
    if (shared && !fix.llmDraft) throw new BadRequestException('There is no draft on this fix to share.');
    return this.prisma.fixSpec.update({
      where: { id: fix.id },
      data: {
        draftShared: shared,
        events: { create: { kind: 'draft', actor: actorId, detail: asJson({ shared }) } },
      },
      include: { sources: true },
    });
  }

  // ─── Summary + export ─────────────────────────────────────────────────

  /** Counts for a dashboard or a report section. */
  async summary(clientId: string, projectId: string) {
    await this.assertProjectInClient(projectId, clientId);
    const [rows, firstRun] = await Promise.all([
      this.prisma.fixSpec.findMany({ where: { projectId }, select: { status: true, fixClass: true, severity: true, lastVerifiedAt: true } }),
      this.prisma.remediationRun.findFirst({ where: { projectId, status: 'COMPLETE' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    ]);
    const byStatus: Record<string, number> = {};
    const byClass: Record<string, number> = {};
    let openHigh = 0;
    let verifiedSinceBaseline = 0;
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      byClass[r.fixClass] = (byClass[r.fixClass] ?? 0) + 1;
      if (r.severity === 'HIGH' && (r.status === 'OPEN' || r.status === 'REGRESSED' || r.status === 'IN_PROGRESS')) openHigh++;
      if (r.status === 'VERIFIED' && r.lastVerifiedAt && firstRun && r.lastVerifiedAt > firstRun.createdAt) verifiedSinceBaseline++;
    }
    return {
      total: rows.length,
      byStatus,
      byClass,
      openHigh,
      awaitingDecision: byStatus.AWAITING_DECISION ?? 0,
      regressed: byStatus.REGRESSED ?? 0,
      verified: byStatus.VERIFIED ?? 0,
      verifiedSinceBaseline,
      baselineAt: firstRun?.createdAt ?? null,
    };
  }

  /** Every non-dismissed fix, as Markdown for a developer/agency or JSON for an agent. */
  async exportFixPack(clientId: string, projectId: string, format: 'md' | 'json', viewer?: Viewer) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null } });
    if (!project) throw new NotFoundException('Project not found.');
    const fixes = (await this.listFixes(clientId, projectId, {}, viewer)).filter((f) => f.status !== 'DISMISSED');
    const pack = toFixPackJson(project, fixes);
    return format === 'json' ? pack : renderFixPackMarkdown(pack);
  }

  private async assertProjectInClient(projectId: string, clientId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundException('Project not found.');
  }
}
