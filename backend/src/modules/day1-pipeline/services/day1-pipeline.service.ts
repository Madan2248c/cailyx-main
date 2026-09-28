/**
 * Day-1 pipeline orchestrator — the automatic end-to-end run.
 *
 * Owns sequencing, retries, partial-failure handling, and spend-ceiling
 * enforcement. Calls each stage's exported service exactly as the admin
 * HTTP endpoints do, and reads stage state only through those services'
 * read methods (no cross-module DB reads). See
 * docs/analysis/day1-pipeline.md.
 *
 * Terminal semantics: COMPLETE = a DAY1 report was RELEASED (skipped
 * stages are fine — Reporting tolerates missing sources). FAILED = no
 * report was released. Only `reporting` is fatal; every other stage
 * failure is recorded and the pipeline continues.
 *
 * @module day1-pipeline/services/day1-pipeline.service
 */

import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { DiscoveryService } from '../../discovery/services/discovery.service.js';
import { TechnicalAuditService } from '../../technical-audit/services/technical-audit.service.js';
import { SocialActivityService } from '../../social-activity/services/social-activity.service.js';
import { QuerySetService } from '../../query-set/services/query-set.service.js';
import { AeoAuditService } from '../../aeo-audit/services/aeo-audit.service.js';
import { CompetitorsService } from '../../competitors/services/competitors.service.js';
import { GapAnalysisService } from '../../gap-analysis/services/gap-analysis.service.js';
import { RemediationSyncService } from '../../remediation/services/remediation-sync.service.js';
import { ReportingService } from '../../reporting/services/reporting.service.js';
import { TeamService } from '../../auth/services/team.service.js';
import type { Surface } from '../../measurement/measurement.types.js';
import {
  DAY1_JOB,
  DAY1_JOB_OPTIONS,
  DAY1_QUEUE,
  type Day1JobData,
} from '../queue/day1-pipeline.queue.js';
import {
  DAY1_MARKETS,
  DAY1_POLL_INTERVAL_ENV,
  DAY1_SURFACES_ENV,
  DEFAULT_DAY1_POLL_INTERVAL_MS,
  DEFAULT_DAY1_SURFACES,
} from '../day1-pipeline.constants.js';
import {
  DAY1_STAGES,
  type Day1Stage,
  type Day1StageRecord,
  type Day1StagesState,
  type StartPipelineOptions,
} from '../day1-pipeline.types.js';

function asJson(value: unknown): any {
  return value;
}

/** Discovery terminal states that still allow the pipeline to proceed. */
const DISCOVERY_DONE = new Set(['COMPLETE', 'COMPLETE_WITH_GAPS', 'MANUAL_REVIEW_REQUIRED']);

@Injectable()
export class Day1PipelineService {
  private readonly logger = new Logger(Day1PipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(DAY1_QUEUE) private readonly queue: Queue<Day1JobData>,
    private readonly config: ConfigService,
    private readonly discovery: DiscoveryService,
    private readonly technicalAudit: TechnicalAuditService,
    private readonly socialActivity: SocialActivityService,
    private readonly querySets: QuerySetService,
    private readonly aeoAudit: AeoAuditService,
    private readonly competitors: CompetitorsService,
    private readonly gapAnalysis: GapAnalysisService,
    private readonly reporting: ReportingService,
    private readonly team: TeamService,
    private readonly remediation: RemediationSyncService,
  ) {}

  /**
   * Creates the pipeline row and enqueues the job. Idempotent per project —
   * returns the existing row when one is already there. Enqueue failure is
   * non-fatal (the row stays QUEUED; the retry endpoint re-enqueues).
   */
  async startPipeline(clientId: string, projectId: string, opts: StartPipelineOptions = {}) {
    const existing = await this.prisma.day1PipelineRun.findUnique({ where: { projectId } });
    if (existing) return existing;

    const row = await this.prisma.day1PipelineRun.create({
      data: {
        projectId,
        clientId,
        stages: asJson({}),
        spendCeilingUsd: opts.spendCeilingUsd ?? null,
        spendAuthorizedAt: new Date(),
      },
    });

    try {
      await this.queue.add(
        DAY1_JOB,
        { pipelineRunId: row.id, projectId, clientId },
        { ...DAY1_JOB_OPTIONS, jobId: row.id },
      );
    } catch (err) {
      this.logger.error(
        `Day-1 pipeline ${row.id} created but could not be enqueued: ${(err as Error).message} — re-enqueue via the retry endpoint.`,
      );
    }
    return row;
  }

  /**
   * Re-enqueues a stalled or failed pipeline. Admin-only (enforced by the
   * controller). COMPLETE and RUNNING rows are rejected — retrying those
   * would double-spend. Creates the row (uncapped, authorized now — the
   * admin click is the authorization) when a legacy project has none.
   */
  async retry(clientId: string, projectId: string) {
    let row = await this.prisma.day1PipelineRun.findUnique({ where: { projectId } });
    if (row && row.clientId !== clientId) {
      throw new NotFoundException('Project not found.');
    }
    if (!row) {
      row = await this.prisma.day1PipelineRun.create({
        data: { projectId, clientId, stages: asJson({}), spendAuthorizedAt: new Date() },
      });
    }
    if (row.status === 'COMPLETE') {
      throw new ConflictException('Day-1 pipeline already completed for this project.');
    }
    if (row.status === 'RUNNING') {
      throw new ConflictException('Day-1 pipeline is already running for this project.');
    }
    await this.queue.add(
      DAY1_JOB,
      { pipelineRunId: row.id, projectId, clientId },
      { ...DAY1_JOB_OPTIONS, jobId: row.id },
    );
    return row;
  }

  /** Pipeline status for a project, scoped to the client. */
  async getStatus(clientId: string, projectId: string) {
    const row = await this.prisma.day1PipelineRun.findUnique({ where: { projectId } });
    if (!row || row.clientId !== clientId) {
      throw new NotFoundException('Project not found.');
    }
    return row;
  }

  /**
   * Runs every stage in order. Called by the BullMQ processor; safe to call
   * again after a crash — recorded completed/skipped stages are not
   * re-triggered, and resumable stages (async runs, AEO audits) pick up
   * where they left off.
   */
  async executePipeline(pipelineRunId: string, onProgress?: (stage: Day1Stage) => void) {
    const row = await this.prisma.day1PipelineRun.findUnique({ where: { id: pipelineRunId } });
    if (!row) {
      this.logger.error(`Day-1 pipeline ${pipelineRunId} not found — nothing to execute.`);
      return null;
    }
    if (row.status === 'COMPLETE') return row;

    const { clientId, projectId } = row;
    const state: Day1StagesState = (row.stages as unknown as Day1StagesState) ?? {};
    await this.prisma.day1PipelineRun.update({
      where: { id: row.id },
      data: { status: 'RUNNING', startedAt: row.startedAt ?? new Date(), currentStage: row.currentStage },
    });

    try {
      for (const stage of DAY1_STAGES) {
        const recorded = state[stage];
        if (recorded?.status === 'completed' || recorded?.status === 'skipped') continue;
        await this.prisma.day1PipelineRun.update({ where: { id: row.id }, data: { currentStage: stage } });
        onProgress?.(stage);
        try {
          state[stage] = await this.runStage(stage, row.id, clientId, projectId, state);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(`Day-1 pipeline ${row.id} stage ${stage} failed: ${message}`);
          const prior = state[stage];
          state[stage] = { status: 'failed', error: message, ...(prior?.runId ? { runId: prior.runId } : {}) };
          // Without a released report there is no pipeline result — every
          // other stage failure is recorded and the pipeline continues.
          if (stage === 'reporting') throw err;
        }
        await this.prisma.day1PipelineRun.update({ where: { id: row.id }, data: { stages: asJson(state) } });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.day1PipelineRun.update({
        where: { id: row.id },
        data: { status: 'FAILED', error: message, finishedAt: new Date(), stages: asJson(state) },
      });
      throw err;
    }

    const reportId = state.reporting?.runId ?? null;
    return this.prisma.day1PipelineRun.update({
      where: { id: row.id },
      data: { status: 'COMPLETE', currentStage: null, reportId, finishedAt: new Date(), stages: asJson(state), error: null },
    });
  }

  // ─── Stage dispatch ────────────────────────────────────────────────

  private runStage(
    stage: Day1Stage,
    pipelineRunId: string,
    clientId: string,
    projectId: string,
    state: Day1StagesState,
  ): Promise<Day1StageRecord> {
    switch (stage) {
      case 'discovery':
        return this.runDiscovery(clientId, projectId, state);
      case 'technical-audit':
        return this.runTechnicalAudit(clientId, projectId, state);
      case 'social-activity':
        return this.runSocialActivity(pipelineRunId, clientId, projectId, state);
      case 'query-set':
        return this.runQuerySet(clientId, projectId);
      case 'aeo-audit':
        return this.runAeoAudit(pipelineRunId, clientId, projectId, state);
      case 'competitors':
        return this.runCompetitors(clientId, projectId);
      case 'gap-analysis':
        return this.runGapAnalysis(clientId, projectId);
      case 'remediation':
        return this.runRemediation(clientId, projectId);
      case 'reporting':
        return this.runReporting(clientId, projectId);
      case 'notify':
        return this.runNotify(clientId);
    }
  }

  private async runDiscovery(clientId: string, projectId: string, state: Day1StagesState): Promise<Day1StageRecord> {
    const recordedId = state.discovery?.runId;
    if (recordedId) {
      try {
        const existing = await this.discovery.getRun(clientId, recordedId);
        if (DISCOVERY_DONE.has(existing.status)) return { status: 'completed', runId: recordedId };
        if (existing.status !== 'FAILED') {
          return this.pollDiscovery(clientId, recordedId);
        }
        // FAILED → fall through to a fresh run below.
      } catch (err) {
        if (!(err instanceof NotFoundException)) throw err;
      }
    }
    const run = await this.discovery.startRun(projectId, 'project-created');
    return this.pollDiscovery(clientId, run.id);
  }

  private async pollDiscovery(clientId: string, runId: string): Promise<Day1StageRecord> {
    for (;;) {
      const run = await this.discovery.getRun(clientId, runId);
      if (DISCOVERY_DONE.has(run.status)) return { status: 'completed', runId };
      if (run.status === 'FAILED') {
        throw new Error(`Discovery run ${runId} failed.`);
      }
      await this.sleep(this.pollIntervalMs());
    }
  }

  private async runTechnicalAudit(clientId: string, projectId: string, state: Day1StagesState): Promise<Day1StageRecord> {
    const recordedId = state['technical-audit']?.runId;
    if (recordedId) {
      try {
        const existing = await this.technicalAudit.getRun(clientId, recordedId);
        if (existing.status === 'COMPLETE') return { status: 'completed', runId: recordedId };
        if (existing.status !== 'FAILED') {
          return this.pollTechnicalAudit(clientId, recordedId);
        }
      } catch (err) {
        if (!(err instanceof NotFoundException)) throw err;
      }
    }
    const run = await this.technicalAudit.startRun(projectId, 'manual');
    return this.pollTechnicalAudit(clientId, run.id);
  }

  private async pollTechnicalAudit(clientId: string, runId: string): Promise<Day1StageRecord> {
    for (;;) {
      const run = await this.technicalAudit.getRun(clientId, runId);
      if (run.status === 'COMPLETE') return { status: 'completed', runId };
      if (run.status === 'FAILED') {
        throw new Error(`Technical audit run ${runId} failed.`);
      }
      await this.sleep(this.pollIntervalMs());
    }
  }

  private async runSocialActivity(
    pipelineRunId: string,
    clientId: string,
    projectId: string,
    state: Day1StagesState,
  ): Promise<Day1StageRecord> {
    const ceilingSkip = await this.checkSpendCeiling(pipelineRunId, clientId, projectId);
    if (ceilingSkip) return ceilingSkip;
    const recordedId = state['social-activity']?.runId;
    if (recordedId) {
      try {
        const existing = await this.socialActivity.getRun(clientId, recordedId);
        if (existing.status === 'COMPLETE') return { status: 'completed', runId: recordedId };
        if (existing.status !== 'FAILED') {
          return this.pollSocialActivity(clientId, recordedId);
        }
      } catch (err) {
        if (!(err instanceof NotFoundException)) throw err;
      }
    }
    const run = await this.socialActivity.startRun(projectId, 'manual');
    return this.pollSocialActivity(clientId, run.id);
  }

  private async pollSocialActivity(clientId: string, runId: string): Promise<Day1StageRecord> {
    for (;;) {
      const run = await this.socialActivity.getRun(clientId, runId);
      if (run.status === 'COMPLETE') return { status: 'completed', runId };
      if (run.status === 'FAILED') {
        throw new Error(`Social activity run ${runId} failed.`);
      }
      await this.sleep(this.pollIntervalMs());
    }
  }

  private async runQuerySet(clientId: string, projectId: string): Promise<Day1StageRecord> {
    const active = await this.querySets.list(clientId, projectId, 'active');
    if (active.length > 0) return { status: 'completed', runId: active[0].id };
    const created = await this.querySets.generate(clientId, projectId);
    await this.querySets.activate(clientId, created.id);
    return { status: 'completed', runId: created.id };
  }

  private async runAeoAudit(
    pipelineRunId: string,
    clientId: string,
    projectId: string,
    state: Day1StagesState,
  ): Promise<Day1StageRecord> {
    const active = await this.querySets.list(clientId, projectId, 'active');
    const querySet = active[0];
    if (!querySet) {
      return { status: 'skipped', skippedReason: 'no-active-query-set' };
    }
    const ceilingSkip = await this.checkSpendCeiling(pipelineRunId, clientId, projectId);
    if (ceilingSkip) return ceilingSkip;

    const recordedId = state['aeo-audit']?.runId;
    if (recordedId) {
      try {
        const existing = await this.aeoAudit.getAudit(clientId, recordedId);
        if (existing.status === 'completed') return { status: 'completed', runId: recordedId };
        // Resumable: run() only touches still-pending surface rows.
        const resumed = await this.aeoAudit.run(clientId, recordedId);
        return this.aeoResult(recordedId, resumed.status);
      } catch (err) {
        if (!(err instanceof NotFoundException)) throw err;
      }
    }
    const created = await this.aeoAudit.create(clientId, projectId, {
      querySetId: querySet.id,
      surfaces: this.day1Surfaces(),
      markets: [...DAY1_MARKETS],
    });
    const result = await this.aeoAudit.run(clientId, created.id);
    return this.aeoResult(created.id, result.status);
  }

  private aeoResult(auditId: string, status: string): Day1StageRecord {
    if (status === 'completed') return { status: 'completed', runId: auditId };
    throw new Error(`AEO audit ${auditId} finished with status ${status} — no surface completed.`);
  }

  private async runCompetitors(clientId: string, projectId: string): Promise<Day1StageRecord> {
    // Synchronous, no run row — per-profile OK/FAILED is tolerated inside.
    await this.competitors.discover(clientId, projectId);
    return { status: 'completed' };
  }

  private async runGapAnalysis(clientId: string, projectId: string): Promise<Day1StageRecord> {
    // Throws Conflict when zero sources have a completed run — recorded as
    // failed upstream, reporting still proceeds without it.
    const run = await this.gapAnalysis.run(clientId, projectId);
    if (run.status !== 'COMPLETE') {
      throw new Error(`Gap analysis run ${run.id} finished with status ${run.status}.`);
    }
    return { status: 'completed', runId: run.id };
  }

  /** Builds the Fix Plan from every audit above. Deterministic, no spend; a failure never blocks the report. */
  private async runRemediation(clientId: string, projectId: string): Promise<Day1StageRecord> {
    const outcome = await this.remediation.sync(clientId, projectId, null);
    return { status: 'completed', runId: outcome.runId };
  }

  private async runReporting(clientId: string, projectId: string): Promise<Day1StageRecord> {
    // Never 409s — a missing source is omitted, never fabricated. The
    // report id is read back (generate returns content, not the row).
    await this.reporting.generate(clientId, projectId, 'DAY1');
    const latest = await this.reporting.list(clientId, projectId, 'DAY1');
    if (latest.length === 0) {
      throw new Error('DAY1 report generation returned no report.');
    }
    return { status: 'completed', runId: latest[0].id };
  }

  private async runNotify(clientId: string): Promise<Day1StageRecord> {
    const result = await this.team.sendDay1ReadyEmail(clientId);
    if (result.sent) return { status: 'completed' };
    return { status: 'skipped', skippedReason: result.reason };
  }

  // ─── Spend ─────────────────────────────────────────────────────────

  /**
   * Best-effort Day-1 spend so far, read off the stages that report costs
   * (social-activity, AEO incl. its measurement runs). Discovery SERP and
   * technical-audit costs have no run-level column and are not counted —
   * small and bounded by their own budgets.
   */
  private async estimateSpendUsd(clientId: string, projectId: string): Promise<number> {
    let spend = 0;
    try {
      const socialRuns = await this.socialActivity.listRuns(clientId, projectId, 1);
      spend += socialRuns[0]?.totalCostUsd ?? 0;
    } catch {
      // A stage that cannot report spend contributes zero, never a failure.
    }
    try {
      const audits = await this.aeoAudit.list(clientId, projectId);
      const latest = audits.find((a) => a.status === 'completed') ?? audits[0];
      spend += latest?.costUsd ?? 0;
    } catch {
      // Same as above.
    }
    return spend;
  }

  private async checkSpendCeiling(
    pipelineRunId: string,
    clientId: string,
    projectId: string,
  ): Promise<Day1StageRecord | null> {
    const row = await this.prisma.day1PipelineRun.findUnique({ where: { id: pipelineRunId } });
    const ceiling = row?.spendCeilingUsd ?? null;
    if (ceiling == null) return null;
    const spent = await this.estimateSpendUsd(clientId, projectId);
    if (spent >= ceiling) {
      return {
        status: 'skipped',
        skippedReason: `spend-ceiling-reached: $${spent.toFixed(2)} of $${ceiling.toFixed(2)} already spent`,
      };
    }
    return null;
  }

  // ─── Config/helpers ────────────────────────────────────────────────

  private day1Surfaces(): Surface[] {
    const raw = this.config.get<string>(DAY1_SURFACES_ENV, DEFAULT_DAY1_SURFACES) ?? DEFAULT_DAY1_SURFACES;
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0) as Surface[];
  }

  private pollIntervalMs(): number {
    const raw = this.config.get<string>(DAY1_POLL_INTERVAL_ENV) ?? String(DEFAULT_DAY1_POLL_INTERVAL_MS);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAY1_POLL_INTERVAL_MS;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
