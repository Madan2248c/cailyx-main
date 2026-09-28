/**
 * Measurement orchestrator — runs a project's active query set's prompts
 * across an AI answer surface and scores the answers into Observations.
 * See docs/analysis (none yet — built per explicit operator instruction,
 * skipping the doc-first gate; ported from the old repo's
 * `measurement.service.ts`).
 *
 * Hard rules enforced here:
 * - runCount >= MIN_RUN_COUNT (1) — a lower value is a 400.
 * - Only an ACTIVE query set can be measured — immutability carries the
 *   comparability guarantee (query-set's own "Decisions carried over").
 * - Rates, never positions — `position` is stored for diagnostics only,
 *   never the summary headline.
 * - Cost-capped via `MEASUREMENT_MAX_COST_PER_RUN` — exceeding the cap
 *   stops the run and marks it failed with the reason.
 *
 * @module measurement/services/measurement.service
 */

import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { DEFAULT_MAX_COST_PER_RUN, MIN_RUN_COUNT } from '../measurement.constants.js';
import type { CreateRunInput, MeasurementSummary, Surface, SurfaceAdapter } from '../measurement.types.js';
import { SURFACES } from '../measurement.types.js';
import { CloroAiModeAdapter, CloroChatGptAdapter, CloroGeminiAdapter, CloroGoogleAiOverviewAdapter, CloroPerplexityAdapter } from '../adapters/cloro.adapter.js';
import { MockSurfaceAdapter } from '../adapters/mock.adapter.js';
import { extractObservation } from './observation-scoring.js';

@Injectable()
export class MeasurementService {
  private readonly logger = new Logger(MeasurementService.name);
  private readonly adapters: Map<Surface, SurfaceAdapter>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    cloroChatGpt: CloroChatGptAdapter,
    cloroPerplexity: CloroPerplexityAdapter,
    cloroGemini: CloroGeminiAdapter,
    cloroAiOverview: CloroGoogleAiOverviewAdapter,
    cloroAiMode: CloroAiModeAdapter,
    mock: MockSurfaceAdapter,
  ) {
    this.adapters = new Map<Surface, SurfaceAdapter>([
      ['cloro_chatgpt', cloroChatGpt],
      ['cloro_perplexity', cloroPerplexity],
      ['cloro_gemini', cloroGemini],
      ['cloro_ai_overview', cloroAiOverview],
      ['cloro_ai_mode', cloroAiMode],
      ['mock', mock],
    ]);
  }

  /**
   * Create a measurement run for an ACTIVE query set.
   * @throws NotFoundException on missing project/query set.
   * @throws ConflictException when the query set is not active.
   * @throws BadRequestException when runCount < MIN_RUN_COUNT, surface unknown, or the set is empty.
   */
  async createRun(clientId: string, projectId: string, input: CreateRunInput) {
    if (!SURFACES.includes(input.surface)) {
      throw new BadRequestException(`Unknown surface '${input.surface}'. Available: ${SURFACES.join(', ')}`);
    }
    if (input.runCount !== undefined && input.runCount < MIN_RUN_COUNT) {
      throw new BadRequestException(`runCount must be >= ${MIN_RUN_COUNT}`);
    }

    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null } });
    if (!project) throw new NotFoundException('Project not found.');

    const querySet = await this.prisma.querySet.findFirst({ where: { id: input.querySetId, projectId }, include: { items: true } });
    if (!querySet) throw new NotFoundException('Query set not found in this project.');
    if (querySet.status !== 'active') {
      throw new ConflictException(`Query set is ${querySet.status}. Only active sets are measured (immutable versions).`);
    }
    if (querySet.items.length === 0) throw new BadRequestException('Cannot measure an empty query set.');

    const run = await this.prisma.measurementRun.create({
      data: {
        projectId,
        querySetId: input.querySetId,
        surface: input.surface,
        geo: input.geo ?? 'US',
        runCount: input.runCount ?? MIN_RUN_COUNT,
        status: 'pending',
      },
    });
    this.logger.log(`Measurement run created ${run.id} (surface=${input.surface}, geo=${run.geo}, n=${run.runCount}, prompts=${querySet.items.length})`);
    return run;
  }

  /**
   * Execute every observation of a run sequentially: for each prompt item
   * x runNumber, call the surface, extract mentioned/cited, store the
   * Observation. Cost-capped — exceeding the cap stops the run and marks it
   * failed with the reason recorded.
   */
  async executeRun(runId: string) {
    const run = await this.prisma.measurementRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Run not found.');
    if (run.status === 'running') throw new ConflictException('Run is already executing.');
    if (run.status === 'completed') {
      throw new ConflictException('Run is already completed. Create a new run instead of re-executing.');
    }
    if (run.status === 'failed') {
      // Retry: wipe partial observations so rates never double-count.
      await this.prisma.observation.deleteMany({ where: { runId: run.id } });
      await this.prisma.measurementRun.update({
        where: { id: run.id },
        data: { totalRequests: 0, completedRequests: 0, failedRequests: 0, costTotal: 0 },
      });
    }

    const adapter = this.adapters.get(run.surface as Surface);
    if (!adapter) throw new BadRequestException(`No adapter for surface '${run.surface}'.`);

    const querySet = await this.prisma.querySet.findUnique({ where: { id: run.querySetId }, include: { items: true } });
    if (!querySet) throw new NotFoundException('Query set for run no longer exists.');
    if (querySet.items.length === 0) throw new BadRequestException('Query set has no prompts.');

    const project = await this.prisma.project.findUnique({ where: { id: run.projectId } });
    if (!project) throw new NotFoundException('Project for run no longer exists.');

    await this.prisma.measurementRun.update({ where: { id: run.id }, data: { status: 'running', startedAt: new Date(), error: null } });

    let costExceeded: string | null = null;

    try {
      for (const item of querySet.items) {
        if (costExceeded) break;
        for (let runNumber = 1; runNumber <= run.runCount; runNumber++) {
          if (costExceeded) break;
          try {
            const answer = await adapter.runPrompt(item.prompt, run.geo);
            const costUsd = answer.costUsd ?? 0;
            const extracted = extractObservation(answer, { name: project.name, domain: project.domain });

            await this.prisma.observation.create({
              data: {
                runId: run.id,
                itemId: item.id,
                runNumber,
                prompt: item.prompt,
                ...extracted,
                rawAnswer: answer.text,
                costUsd,
                latencyMs: answer.latencyMs,
                model: answer.model,
              },
            });

            await this.prisma.measurementRun.update({
              where: { id: run.id },
              data: { totalRequests: { increment: 1 }, completedRequests: { increment: 1 }, costTotal: { increment: costUsd } },
            });

            const current = await this.prisma.measurementRun.findUnique({ where: { id: run.id } });
            const cap = this.costCap();
            if (current && current.costTotal > cap) {
              costExceeded = `Cost cap exceeded: $${current.costTotal.toFixed(2)} > $${cap.toFixed(2)} (MEASUREMENT_MAX_COST_PER_RUN).`;
              this.logger.warn(costExceeded);
            }
          } catch (err) {
            await this.prisma.measurementRun.update({
              where: { id: run.id },
              data: { totalRequests: { increment: 1 }, failedRequests: { increment: 1 } },
            });
            this.logger.error(`Observation failed (run=${run.id}, item=${item.id}, n=${runNumber}): ${(err as Error).message}`);
          }
        }
      }
    } finally {
      const finished = await this.prisma.measurementRun.findUnique({ where: { id: run.id } });
      if (finished) {
        await this.prisma.measurementRun.update({
          where: { id: run.id },
          data: {
            status: costExceeded ? 'failed' : finished.completedRequests > 0 ? 'completed' : 'failed',
            error: costExceeded,
            finishedAt: new Date(),
          },
        });
      }
    }

    return this.prisma.measurementRun.findUnique({ where: { id: run.id }, include: { observations: true } });
  }

  /** List the project's runs (newest first), optionally filtered by surface. */
  async listRuns(clientId: string, projectId: string, surface?: string) {
    await this.assertProjectInClient(projectId, clientId);
    return this.prisma.measurementRun.findMany({
      where: { projectId, ...(surface ? { surface: surface as Surface } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** One run with its observations (project-ownership checked). */
  async getRun(clientId: string, runId: string) {
    const run = await this.prisma.measurementRun.findFirst({
      where: { id: runId, project: { clientId, deletedAt: null } },
      include: { observations: { orderBy: [{ itemId: 'asc' }, { runNumber: 'asc' }] } },
    });
    if (!run) throw new NotFoundException('Run not found.');
    return run;
  }

  /**
   * Aggregate rates for the project (optionally scoped to one run). See
   * `MeasurementSummary`'s type doc for the cohort semantics and the
   * always-empty `shareOfVoice` gap.
   */
  async summary(clientId: string, projectId: string, runId?: string): Promise<MeasurementSummary> {
    await this.assertProjectInClient(projectId, clientId);

    if (runId) {
      const owned = await this.prisma.measurementRun.findFirst({ where: { id: runId, projectId }, select: { id: true } });
      if (!owned) throw new NotFoundException('Run not found in this project.');
    }

    const obsWhere = runId ? { runId } : { run: { projectId } };
    const observations = await this.prisma.observation.findMany({ where: obsWhere });
    const runs = await this.prisma.measurementRun.count({ where: { projectId } });

    if (observations.length === 0) {
      return { runs, observations: 0, mentionRate: null, citationRate: null, bySurface: [], byFunnelStage: [], shareOfVoice: [] };
    }

    const items = await this.prisma.querySetItem.findMany({ where: { querySet: { projectId } }, select: { id: true, funnelStage: true } });
    const stageByItem = new Map(items.map((i) => [i.id, i.funnelStage]));
    const runRows = await this.prisma.measurementRun.findMany({ where: runId ? { id: runId } : { projectId }, select: { id: true, surface: true } });
    const surfaceByRun = new Map(runRows.map((r) => [r.id, r.surface]));

    const surfRows = new Map<string, { n: number; m: number; c: number }>();
    const stRows = new Map<string, { n: number; m: number; c: number }>();
    let mentionCount = 0;
    let citeCount = 0;

    for (const o of observations) {
      if (o.mentioned) mentionCount += 1;
      if (o.cited) citeCount += 1;

      const surf = surfaceByRun.get(o.runId) ?? 'unknown';
      const surfRow = surfRows.get(surf) ?? { n: 0, m: 0, c: 0 };
      surfRow.n += 1;
      if (o.mentioned) surfRow.m += 1;
      if (o.cited) surfRow.c += 1;
      surfRows.set(surf, surfRow);

      const stage = stageByItem.get(o.itemId) ?? 'unknown';
      const stRow = stRows.get(stage) ?? { n: 0, m: 0, c: 0 };
      stRow.n += 1;
      if (o.mentioned) stRow.m += 1;
      if (o.cited) stRow.c += 1;
      stRows.set(stage, stRow);
    }

    return {
      runs,
      observations: observations.length,
      mentionRate: Number((mentionCount / observations.length).toFixed(4)),
      citationRate: Number((citeCount / observations.length).toFixed(4)),
      bySurface: [...surfRows.entries()].map(([surface, r]) => ({
        surface,
        observations: r.n,
        mentionRate: Number((r.m / r.n).toFixed(4)),
        citationRate: Number((r.c / r.n).toFixed(4)),
      })),
      byFunnelStage: [...stRows.entries()].map(([funnelStage, r]) => ({
        funnelStage,
        observations: r.n,
        mentionRate: Number((r.m / r.n).toFixed(4)),
        citationRate: Number((r.c / r.n).toFixed(4)),
      })),
      shareOfVoice: [], // no competitor data source wired yet — see MeasurementSummary's type doc
    };
  }

  private async assertProjectInClient(projectId: string, clientId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundException('Project not found.');
  }

  /** Per-run cost ceiling in USD from config. */
  private costCap(): number {
    return Number(this.config.get<string>('MEASUREMENT_MAX_COST_PER_RUN', String(DEFAULT_MAX_COST_PER_RUN)));
  }
}
