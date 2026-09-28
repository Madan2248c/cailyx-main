/**
 * Remediation sync — the one write path from audit findings to fix specs.
 * Deterministic: no LLM, no paid call. See docs/analysis/remediation.md
 * "Pipeline" for the eight steps.
 *
 * Idempotent by construction: every spec is upserted by
 * `sha256(projectId | problemKey | target)`, so re-running a sync on the same
 * audit data changes nothing but `updatedAt`. Status is never reset by a
 * sync — the only status changes a sync makes are:
 *   - new spec → `OPEN` (or `AWAITING_DECISION`)
 *   - `VERIFIED` spec reported again by a run newer than its verification → `REGRESSED`
 *   - open spec no longer reported by a newer run that actually looked → `VERIFIED`
 *
 * @module remediation/services/remediation-sync.service
 */

import { createHash } from 'node:crypto';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { FixStatus } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { SourceSnapshotCollector } from '../collectors/source-snapshot.collector.js';
import { applyGuardrails, coverageOf } from '../guardrails/remediation.guardrails.js';
import { HANDLERS } from '../handlers/handler.registry.js';
import type { FixSourceRef, FixSpecDraft, RemediationHandler, SourceSnapshot, VerifyResult } from '../remediation.types.js';
import { RECONCILABLE } from './fix-status.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
function asJson(value: unknown): any {
  return JSON.parse(JSON.stringify(value ?? null)) as any;
}

export function fingerprint(projectId: string, problemKey: string, target: string): string {
  return createHash('sha256').update(`${projectId}|${problemKey}|${target}`).digest('hex');
}

/** Drafts that describe the same problem on the same target become one, with every source kept. */
export function mergeDrafts(projectId: string, drafts: FixSpecDraft[]): Map<string, FixSpecDraft> {
  const out = new Map<string, FixSpecDraft>();
  for (const d of drafts) {
    const fp = fingerprint(projectId, d.problemKey, d.target);
    const existing = out.get(fp);
    if (!existing) {
      out.set(fp, d);
      continue;
    }
    const seen = new Set(existing.sources.map((s) => `${s.module}|${s.findingRef}`));
    const extra = d.sources.filter((s) => !seen.has(`${s.module}|${s.findingRef}`));
    out.set(fp, { ...existing, sources: [...existing.sources, ...extra] });
  }
  return out;
}

/** The newest completion time among the runs a draft cites. */
export function reportedAt(sources: FixSourceRef[], snapshot: SourceSnapshot): Date {
  const times = sources.map((s) => {
    if (s.module === 'technical-audit') return snapshot.technicalAudit?.completedAt;
    if (s.module === 'social-activity') return snapshot.socialActivity?.completedAt;
    return snapshot.aeoAudit?.completedAt;
  });
  const valid = times.filter((t): t is Date => t instanceof Date);
  return valid.length > 0 ? new Date(Math.max(...valid.map((t) => t.getTime()))) : new Date();
}

/** The latest Gap Analysis recommendation that cites any of the same findings. */
export function linkedGapRecommendation(sources: FixSourceRef[], snapshot: SourceSnapshot): string | null {
  const recs = snapshot.gapAnalysis?.recommendations ?? [];
  for (const rec of recs) {
    if (rec.sourceFindings.some((sf) => sources.some((s) => s.module === sf.module && s.findingRef === sf.findingRef))) return rec.id;
  }
  return null;
}

export interface SyncOutcome {
  runId: string;
  created: number;
  updated: number;
  verified: number;
  regressed: number;
  dropped: number;
}

@Injectable()
export class RemediationSyncService {
  private readonly logger = new Logger(RemediationSyncService.name);
  /** Overridable in tests. */
  handlers: readonly RemediationHandler[] = HANDLERS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly collector: SourceSnapshotCollector,
  ) {}

  async sync(clientId: string, projectId: string, actorId: string | null): Promise<SyncOutcome> {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null } });
    if (!project) throw new NotFoundException('Project not found.');

    const snapshot = await this.collector.collect(project);
    if (!snapshot.technicalAudit && !snapshot.socialActivity && !snapshot.aeoAudit) {
      throw new ConflictException('No completed Technical Audit, Social Activity or AEO Audit run exists yet — nothing to fix.');
    }

    const run = await this.prisma.remediationRun.create({
      data: {
        projectId,
        status: 'RUNNING',
        sourceTechnicalAuditRunId: snapshot.technicalAudit?.runId ?? null,
        sourceSocialActivityRunId: snapshot.socialActivity?.runId ?? null,
        sourceAeoAuditId: snapshot.aeoAudit?.runId ?? null,
        sourceGapAnalysisRunId: snapshot.gapAnalysis?.runId ?? null,
        triggeredBy: actorId,
      },
    });

    try {
      const drafts = this.handlers.flatMap((h) => h.detect(snapshot));
      const { kept, dropped } = await applyGuardrails(drafts, snapshot);
      const merged = mergeDrafts(projectId, kept);
      const outcome = await this.persist(run.id, projectId, snapshot, merged);

      await this.prisma.remediationRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETE',
          createdCount: outcome.created,
          updatedCount: outcome.updated,
          verifiedCount: outcome.verified,
          regressedCount: outcome.regressed,
          droppedDrafts: asJson(dropped),
          completedAt: new Date(),
        },
      });
      this.logger.log(
        `Remediation sync ${run.id}: ${outcome.created} new, ${outcome.updated} updated, ${outcome.verified} verified, ${outcome.regressed} regressed, ${dropped.length} dropped.`,
      );
      return { runId: run.id, ...outcome, dropped: dropped.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Remediation sync ${run.id} failed: ${message}`);
      await this.prisma.remediationRun.update({ where: { id: run.id }, data: { status: 'FAILED', error: message, completedAt: new Date() } });
      throw err;
    }
  }

  private async persist(runId: string, projectId: string, snapshot: SourceSnapshot, merged: Map<string, FixSpecDraft>) {
    const existing = await this.prisma.fixSpec.findMany({ where: { projectId }, include: { sources: true } });
    const byFingerprint = new Map(existing.map((e) => [e.fingerprint, e]));
    let created = 0;
    let updated = 0;
    let verified = 0;
    let regressed = 0;

    for (const [fp, draft] of merged) {
      const at = reportedAt(draft.sources, snapshot);
      const content = {
        problemKey: draft.problemKey,
        target: draft.target,
        fixClass: draft.fixClass,
        method: draft.method,
        groupKey: draft.groupKey,
        severity: draft.severity,
        effort: draft.effort,
        title: draft.title,
        evidence: asJson(draft.evidence),
        artifact: draft.artifact ? asJson(draft.artifact) : null,
        artifactError: draft.artifactError ?? null,
        steps: asJson(draft.steps),
        acceptance: asJson(draft.acceptance),
        needsClientDecision: draft.needsClientDecision ?? false,
        gapRecommendationId: linkedGapRecommendation(draft.sources, snapshot),
      };
      const sources = draft.sources.map((s) => ({ module: s.module, runId: s.runId, findingRef: s.findingRef }));
      const prior = byFingerprint.get(fp);

      if (!prior) {
        const status: FixStatus = draft.needsClientDecision ? 'AWAITING_DECISION' : 'OPEN';
        await this.prisma.fixSpec.create({
          data: {
            ...content,
            projectId,
            fingerprint: fp,
            status,
            lastReportedAt: at,
            sources: { create: sources },
            events: { create: { kind: 'sync', toStatus: status, actor: 'system', detail: asJson({ remediationRunId: runId, created: true }) } },
          },
        });
        created++;
        continue;
      }

      const regress = prior.status === 'VERIFIED' && prior.lastVerifiedAt !== null && at > prior.lastVerifiedAt;
      const nextStatus: FixStatus = regress ? 'REGRESSED' : prior.status;
      await this.prisma.$transaction([
        this.prisma.fixSpecSource.deleteMany({ where: { fixSpecId: prior.id } }),
        this.prisma.fixSpec.update({
          where: { id: prior.id },
          data: {
            ...content,
            status: nextStatus,
            lastReportedAt: at > prior.lastReportedAt ? at : prior.lastReportedAt,
            sources: { create: sources },
            ...(regress
              ? { events: { create: { kind: 'sync', fromStatus: prior.status, toStatus: nextStatus, actor: 'system', detail: asJson({ remediationRunId: runId, reason: 'Reported again by an audit newer than its verification.' }) } } }
              : {}),
          },
        }),
      ]);
      updated++;
      if (regress) regressed++;
    }

    for (const prior of existing) {
      if (merged.has(prior.fingerprint) || !RECONCILABLE.includes(prior.status)) continue;
      const coveredAt = coverageOf({ problemKey: prior.problemKey, target: prior.target, sources: prior.sources }, snapshot);
      if (!coveredAt || coveredAt <= prior.lastReportedAt) continue;

      const result: VerifyResult = {
        passed: true,
        kind: 'finding-absent',
        checkedAt: new Date().toISOString(),
        observed: `No longer reported by the ${[...new Set(prior.sources.map((s) => s.module))].join(' + ')} run completed ${coveredAt.toISOString()}.`,
      };
      await this.prisma.fixSpec.update({
        where: { id: prior.id },
        data: {
          status: 'VERIFIED',
          lastVerifiedAt: coveredAt,
          lastVerifyResult: asJson(result),
          events: { create: { kind: 'verify', fromStatus: prior.status, toStatus: 'VERIFIED', actor: 'system', detail: asJson({ remediationRunId: runId, ...result }) } },
        },
      });
      verified++;
    }

    return { created, updated, verified, regressed };
  }
}
