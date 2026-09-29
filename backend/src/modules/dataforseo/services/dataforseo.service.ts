/**
 * DataForSEO orchestrator — on-demand and scheduled snapshot collects.
 *
 * Every paid path goes through the Mock adapter: `collectNow` fails
 * closed (503, nothing stored) when `DATAFORSEO_ALLOW_MOCK` is not `1`,
 * so a misconfigured deploy can never spend. Snapshots are append-only —
 * this service exposes no update or delete; a re-collect supersedes by
 * recency, never by mutation.
 *
 * Cost discipline: `DATAFORSEO_MAX_COST_PER_RUN_USD` (default 5.00) —
 * datasets are collected in request order and the collect stops (not
 * mid-dataset) the moment the next dataset would cross the cap; skipped
 * datasets are reported, never silently dropped.
 *
 * @module dataforseo/services/dataforseo.service
 */

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { LiveDataforseoAdapter } from '../adapters/live.adapter.js';
import { MockDataforseoAdapter } from '../adapters/mock.adapter.js';
import {
  DEFAULT_MAX_COST_PER_RUN_USD,
  DEFAULT_PERIOD_DAYS,
  DEFAULT_SNAPSHOT_TAKE,
  MAX_SNAPSHOT_TAKE,
} from '../dataforseo.constants.js';
import { DATASETS, type DataforseoAdapter, type DataforseoDataset } from '../dataforseo.types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
function asJson(value: unknown): any {
  return JSON.parse(JSON.stringify(value ?? null)) as any;
}

export interface CollectResult {
  snapshots: Array<{ id: string; dataset: string; costUsd: number | null }>;
  totalCostUsd: number;
  /** Requested datasets not collected because the cost cap stopped the run. */
  skipped: string[];
}

@Injectable()
export class DataforseoService {
  private readonly logger = new Logger(DataforseoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mock: MockDataforseoAdapter,
    private readonly live: LiveDataforseoAdapter,
  ) {}

  /** Real data when DATAFORSEO_LIVE=1 and credentials are set; otherwise the (separately gated) mock. */
  private adapter(): DataforseoAdapter {
    return LiveDataforseoAdapter.isEnabled(this.config) ? this.live : this.mock;
  }

  /**
   * Collect one append-only snapshot per dataset for the project, in
   * request order (default: every dataset). Unknown dataset names 400
   * before anything is stored. The cost cap stops the run between
   * datasets — never mid-dataset, never silently.
   */
  async collectNow(
    clientId: string,
    projectId: string,
    datasets?: string[],
    opts: { confirmSpend?: boolean } = {},
  ): Promise<CollectResult> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, clientId, deletedAt: null },
      select: { id: true, domain: true },
    });
    if (!project) throw new NotFoundException('Project not found.');

    const wanted = datasets ?? [...DATASETS];
    const unknown = wanted.filter((d) => !(DATASETS as readonly string[]).includes(d));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown datasets: ${unknown.join(', ')}. Available: ${DATASETS.join(', ')}`);
    }

    const adapter = this.adapter();
    if (adapter.name === 'live' && opts.confirmSpend !== true) {
      throw new BadRequestException(
        'Live DataForSEO collects spend real credit. Pass confirmSpend: true. Nothing was run and nothing was spent.',
      );
    }
    const cap = this.costCap();
    const now = new Date();
    const periodStart = new Date(now.getTime() - DEFAULT_PERIOD_DAYS * 86_400_000);

    const snapshots: CollectResult['snapshots'] = [];
    const skipped: string[] = [];
    let totalCostUsd = 0;

    // Sequential in request order — the cost ceiling needs ordering, and
    // per-dataset isolation means one failed fetch never aborts the rest.
    for (const dataset of wanted as DataforseoDataset[]) {
      try {
        const result = await adapter.fetchDataset(dataset, project.domain);
        if (totalCostUsd + result.costUsd > cap) {
          skipped.push(dataset);
          continue;
        }
        totalCostUsd += result.costUsd;
        const row = await this.prisma.dataforseoSnapshot.create({
          data: {
            projectId,
            dataset,
            periodStart,
            periodEnd: now,
            payload: asJson(result.payload),
            costUsd: result.costUsd,
          },
          select: { id: true, dataset: true, costUsd: true },
        });
        snapshots.push(row);
      } catch (err) {
        // The mock gate (503) is fail-closed for the whole collect: a
        // disabled adapter means nothing was approved to run, so nothing
        // partial is kept either.
        if (snapshots.length === 0 && skipped.length === 0) throw err;
        this.logger.warn(`Dataset ${dataset} for project ${projectId} failed: ${(err as Error).message}`);
        skipped.push(dataset);
      }
    }

    this.logger.log(`DataForSEO collect for project ${projectId}: ${snapshots.length} snapshots, $${totalCostUsd.toFixed(3)} ${adapter.name} spend`);
    return { snapshots, totalCostUsd, skipped };
  }

  /** This project's snapshots, newest first. `dataset` filters. */
  async listSnapshots(clientId: string, projectId: string, dataset?: string, take = DEFAULT_SNAPSHOT_TAKE) {
    await this.assertProjectInClient(projectId, clientId);
    if (dataset !== undefined && !(DATASETS as readonly string[]).includes(dataset)) {
      throw new BadRequestException(`Unknown dataset '${dataset}'. Available: ${DATASETS.join(', ')}`);
    }
    return this.prisma.dataforseoSnapshot.findMany({
      where: { projectId, ...(dataset ? { dataset } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, MAX_SNAPSHOT_TAKE),
    });
  }

  /** One snapshot, scoped to the caller's client — snapshots are read-only. */
  async getSnapshot(clientId: string, snapshotId: string) {
    const snapshot = await this.prisma.dataforseoSnapshot.findFirst({
      where: { id: snapshotId, project: { clientId, deletedAt: null } },
    });
    if (!snapshot) throw new NotFoundException('Snapshot not found.');
    return snapshot;
  }

  private async assertProjectInClient(projectId: string, clientId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, clientId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found.');
  }

  /** Per-collect spend ceiling in USD from config. */
  private costCap(): number {
    const raw = Number(this.config.get<string>('DATAFORSEO_MAX_COST_PER_RUN_USD', String(DEFAULT_MAX_COST_PER_RUN_USD)));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_COST_PER_RUN_USD;
  }
}
