/**
 * AEO Audit orchestrator — ties an ACTIVE query set to one or more
 * Measurement runs (one per surface x market), judges stance, assembles a
 * verdict, writes a best-effort narrative. Ported and adapted from the old
 * repo's `aeo-audit.service.ts` — see module README for what was kept,
 * dropped, or changed.
 *
 * Never generates its own query set (the layering fix Query Set's own
 * design doc records): `create()` requires an already-active set id.
 *
 * Resumable by construction: `run()` only touches `AeoSurfaceRun` rows
 * still `pending`, so re-calling it after a partial failure (cost cap hit,
 * process crash) picks up exactly where it left off rather than
 * re-spending on what already completed.
 *
 * @module aeo-audit/services/aeo-audit.service
 */

import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { MeasurementService } from '../../measurement/services/measurement.service.js';
import { CloroClient } from '../../measurement/adapters/cloro.adapter.js';
import { CLORO_BASE_CREDITS, type CloroSurface } from '../../measurement/adapters/cloro.adapter.js';
import { SURFACES, type Surface } from '../../measurement/measurement.types.js';
import { DEFAULT_MAX_COST_PER_AUDIT } from '../aeo-audit.constants.js';
import type { AeoVerdict } from '../aeo-audit.types.js';
import { AeoNarrativeService } from './aeo-narrative.service.js';
import { AeoStanceService } from './aeo-stance.service.js';
import { areAuditsComparable } from './aeo-comparability.js';
import { buildVerdict, type VerdictObservation, type VerdictStance } from './aeo-verdict.js';
import { CompetitorService } from './competitor.service.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
function asJson(value: unknown): any {
  return JSON.parse(JSON.stringify(value ?? null)) as any;
}

export interface CreateAuditInput {
  querySetId: string;
  surfaces: Surface[];
  markets?: string[];
}

@Injectable()
export class AeoAuditService {
  private readonly logger = new Logger(AeoAuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly measurement: MeasurementService,
    private readonly cloro: CloroClient,
    private readonly stance: AeoStanceService,
    private readonly narrative: AeoNarrativeService,
    private readonly competitors: CompetitorService,
  ) {}

  // ─── Creating an audit (cheap, no spend) ───────────────────────────────

  async create(clientId: string, projectId: string, input: CreateAuditInput) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null } });
    if (!project) throw new NotFoundException('Project not found.');

    const unknown = input.surfaces.filter((s) => !SURFACES.includes(s));
    if (unknown.length > 0) throw new BadRequestException(`Unknown surfaces: ${unknown.join(', ')}.`);
    if (input.surfaces.length === 0) throw new BadRequestException('At least one surface is required.');

    const querySet = await this.prisma.querySet.findFirst({ where: { id: input.querySetId, projectId } });
    if (!querySet) throw new NotFoundException('Query set not found in this project.');
    if (querySet.status !== 'active') {
      throw new ConflictException(`Query set is ${querySet.status} — an AEO audit can only run against an active set.`);
    }
    const promptCount = await this.prisma.querySetItem.count({ where: { querySetId: input.querySetId } });
    if (promptCount === 0) throw new BadRequestException('Query set has no prompts.');

    const markets = input.markets && input.markets.length > 0 ? input.markets : ['US'];

    return this.prisma.$transaction(async (tx) => {
      const audit = await tx.aeoAudit.create({
        data: { projectId, querySetId: input.querySetId, surfaces: input.surfaces, markets, promptCount, status: 'pending' },
      });
      for (const surface of input.surfaces) {
        for (const market of markets) {
          await tx.aeoSurfaceRun.create({ data: { auditId: audit.id, surface, market, status: 'pending' } });
        }
      }
      return audit;
    });
  }

  // ─── Running an audit (spends real credit) ─────────────────────────────

  /**
   * Drives every still-`pending` surface run to completion (or failure),
   * stopping new work once the audit-wide cost cap is crossed, then judges
   * stance over what completed, builds the verdict, and writes a
   * best-effort narrative. Safe to call again on a partially-completed
   * audit — only `pending` rows are touched.
   */
  async run(clientId: string, auditId: string) {
    const audit = await this.getOwned(clientId, auditId);
    if (audit.status === 'completed') {
      throw new ConflictException('Audit is already completed — create a new audit instead of re-running.');
    }

    await this.prisma.aeoAudit.update({ where: { id: audit.id }, data: { status: 'running', startedAt: audit.startedAt ?? new Date() } });

    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: audit.projectId } });
    const cap = this.costCap();
    let spent = audit.costUsd;

    const pendingRuns = await this.prisma.aeoSurfaceRun.findMany({ where: { auditId: audit.id, status: 'pending' } });
    for (const surfaceRun of pendingRuns) {
      if (spent >= cap) {
        await this.prisma.aeoSurfaceRun.update({
          where: { id: surfaceRun.id },
          data: { status: 'failed', failureKind: 'audit-cost-cap', error: `Audit-wide cost cap $${cap.toFixed(2)} reached before this surface ran.` },
        });
        continue;
      }

      const budgetOk = await this.fitsRemainingBudget(surfaceRun.surface as Surface, audit.promptCount, cap - spent);
      if (!budgetOk) {
        await this.prisma.aeoSurfaceRun.update({
          where: { id: surfaceRun.id },
          data: { status: 'failed', failureKind: 'insufficient-credits', error: 'Pre-flight credit estimate exceeds remaining audit budget.' },
        });
        continue;
      }

      await this.prisma.aeoSurfaceRun.update({ where: { id: surfaceRun.id }, data: { status: 'running', startedAt: new Date() } });
      try {
        const measurementRun = await this.measurement.createRun(clientId, audit.projectId, {
          querySetId: audit.querySetId,
          surface: surfaceRun.surface as Surface,
          geo: surfaceRun.market,
        });
        const executed = await this.measurement.executeRun(measurementRun.id);
        const observationCount = executed?.observations.length ?? 0;
        const runCost = executed?.costTotal ?? 0;
        spent += runCost;

        await this.prisma.aeoSurfaceRun.update({
          where: { id: surfaceRun.id },
          data: {
            measurementRunId: measurementRun.id,
            status: executed?.status === 'completed' ? 'completed' : 'failed',
            observations: observationCount,
            costUsd: runCost,
            failureKind: executed?.status === 'completed' ? null : 'measurement-failed',
            error: executed?.error ?? null,
            finishedAt: new Date(),
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`AEO audit ${audit.id} surface ${surfaceRun.surface}/${surfaceRun.market} failed: ${message}`);
        await this.prisma.aeoSurfaceRun.update({
          where: { id: surfaceRun.id },
          data: { status: 'failed', failureKind: 'exception', error: message, finishedAt: new Date() },
        });
      }
      await this.prisma.aeoAudit.update({ where: { id: audit.id }, data: { costUsd: spent } });
    }

    const completedRuns = await this.prisma.aeoSurfaceRun.findMany({ where: { auditId: audit.id, status: 'completed' } });
    if (completedRuns.length === 0) {
      await this.prisma.aeoAudit.update({ where: { id: audit.id }, data: { status: 'failed', finishedAt: new Date() } });
      return this.getOwned(clientId, auditId);
    }

    // Stance: share what's left of the audit budget across every completed run's observations.
    const observationsForStance = await this.prisma.observation.findMany({
      where: { run: { aeoSurfaceRuns: { some: { auditId: audit.id } } } },
    });
    let stanceBudget = cap - spent;
    let stanceJudged = 0;
    for (const obs of observationsForStance) {
      if (stanceBudget <= 0) break;
      try {
        const knownNames = await this.competitors.knownNames(audit.projectId);
        const judgment = await this.stance.judge({
          observationId: obs.id,
          rawAnswer: obs.rawAnswer,
          subjectName: project.name,
          knownCompetitorNames: knownNames,
        });
        await this.prisma.aeoStance.create({
          data: {
            auditId: audit.id,
            observationId: obs.id,
            surface: (await this.surfaceForObservation(obs.runId)) as Surface,
            stance: judgment.stance,
            rankAmongBrands: judgment.rankAmongBrands,
            brandsNamed: judgment.brandsNamed,
            recommendedOver: judgment.recommendedOver,
            losesTo: judgment.losesTo,
            otherNamesSeen: judgment.otherNamesSeen,
            evidenceQuote: judgment.evidenceQuote,
            rationale: judgment.rationale,
            judgeModel: judgment.judgeModel,
            costUsd: judgment.costUsd,
          },
        });
        for (const name of judgment.otherNamesSeen) {
          await this.competitors.recordCandidate(audit.projectId, name);
        }
        stanceBudget -= judgment.costUsd;
        spent += judgment.costUsd;
        stanceJudged += 1;
      } catch (err) {
        this.logger.warn(`Stance judging failed for observation ${obs.id}: ${(err as Error).message}`);
      }
    }

    const verdict = await this.computeVerdict(audit.id);

    await this.prisma.aeoAudit.update({
      where: { id: audit.id },
      data: {
        status: 'completed',
        observations: observationsForStance.length,
        stanceJudged,
        costUsd: spent,
        verdict: asJson(verdict),
        finishedAt: new Date(),
      },
    });

    // Best-effort narrative — never blocks completion, failure is logged only.
    await this.writeNarrative(clientId, audit.id, verdict).catch((err) => {
      this.logger.warn(`Narrative failed for audit ${audit.id}: ${(err as Error).message}`);
    });

    return this.getOwned(clientId, auditId);
  }

  private async surfaceForObservation(runId: string): Promise<string> {
    const run = await this.prisma.measurementRun.findUniqueOrThrow({ where: { id: runId }, select: { surface: true } });
    return run.surface;
  }

  /** Best-effort estimate; `mock` and any surface missing a known unit cost always passes (nothing to estimate against). */
  private async fitsRemainingBudget(surface: Surface, promptCount: number, remaining: number): Promise<boolean> {
    const unit = CLORO_BASE_CREDITS[surface as CloroSurface];
    if (!unit) return true;
    try {
      const creditsAvailable = await this.cloro.getRemainingCredits();
      const creditUsd = this.config.get<number>('CLORO_CREDIT_USD') ?? 0.0004;
      const estimatedCost = unit * promptCount * creditUsd;
      return estimatedCost <= remaining && unit * promptCount <= creditsAvailable;
    } catch {
      return true; // credit check itself failing (e.g. key disabled) — let the real run surface the real error
    }
  }

  // ─── Verdict ─────────────────────────────────────────────────────────

  /** Recomputes the verdict fresh from stored rows — side-effect free, cheap, never trusts the cached `AeoAudit.verdict` blindly. */
  async computeVerdict(auditId: string): Promise<AeoVerdict> {
    const audit = await this.prisma.aeoAudit.findUniqueOrThrow({ where: { id: auditId } });
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: audit.projectId } });
    const observations = await this.prisma.observation.findMany({
      where: { run: { aeoSurfaceRuns: { some: { auditId } } } },
      include: { item: { include: { bucket: true } }, run: true },
    });
    const stances = await this.prisma.aeoStance.findMany({ where: { auditId } });

    const verdictObservations: VerdictObservation[] = observations.map((o) => ({
      id: o.id,
      prompt: o.prompt,
      mentioned: o.mentioned,
      cited: o.cited,
      surface: o.run.surface,
      bucketName: o.item.bucket?.name ?? null,
      funnelStage: o.item.funnelStage,
      branding: o.item.branding,
    }));
    const verdictStances: VerdictStance[] = stances.map((s) => ({
      observationId: s.observationId,
      stance: s.stance,
      recommendedOver: s.recommendedOver,
      losesTo: s.losesTo,
      brandsNamed: s.brandsNamed,
    }));

    return buildVerdict(verdictObservations, verdictStances, project.name);
  }

  async getVerdict(clientId: string, auditId: string): Promise<AeoVerdict> {
    await this.getOwned(clientId, auditId);
    return this.computeVerdict(auditId);
  }

  private async writeNarrative(clientId: string, auditId: string, verdict: AeoVerdict): Promise<void> {
    const audit = await this.prisma.aeoAudit.findUniqueOrThrow({ where: { id: auditId } });
    const previous = await this.prisma.aeoAudit.findFirst({
      where: { projectId: audit.projectId, status: 'completed', id: { not: auditId } },
      orderBy: { finishedAt: 'desc' },
    });
    const priorHeadlines =
      previous && areAuditsComparable({ querySetId: audit.querySetId, surfaces: audit.surfaces, markets: audit.markets }, { querySetId: previous.querySetId, surfaces: previous.surfaces, markets: previous.markets })
        ? ((previous.verdict as unknown as AeoVerdict)?.headlines ?? undefined)
        : undefined;

    const result = await this.narrative.write({ headlines: verdict.headlines, priorHeadlines });
    const currentVerdictJson = asJson(verdict);
    await this.prisma.aeoAudit.updateMany({
      where: { id: auditId, verdict: { equals: currentVerdictJson } },
      data: { verdict: asJson({ ...verdict, narrative: result.headlines }) },
    });
  }

  async regenerateNarrative(clientId: string, auditId: string) {
    const audit = await this.getOwned(clientId, auditId);
    if (audit.status !== 'completed') throw new ConflictException('Only a completed audit has a verdict to narrate.');
    const verdict = await this.computeVerdict(auditId);
    await this.writeNarrative(clientId, auditId, verdict);
    return this.getOwned(clientId, auditId);
  }

  // ─── Reads ──────────────────────────────────────────────────────────

  async list(clientId: string, projectId: string) {
    await this.assertProjectInClient(projectId, clientId);
    return this.prisma.aeoAudit.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
  }

  async getAudit(clientId: string, auditId: string) {
    return this.getOwned(clientId, auditId, { include: { surfaceRuns: true } });
  }

  private async getOwned(clientId: string, auditId: string, opts: { include?: any } = {}) {
    const audit = await this.prisma.aeoAudit.findFirst({ where: { id: auditId, project: { clientId, deletedAt: null } }, ...opts });
    if (!audit) throw new NotFoundException('Audit not found.');
    return audit as any;
  }

  private async assertProjectInClient(projectId: string, clientId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundException('Project not found.');
  }

  private costCap(): number {
    return Number(this.config.get<string>('AEO_MAX_COST_PER_AUDIT', String(DEFAULT_MAX_COST_PER_AUDIT)));
  }
}
