/**
 * Schedule manager for recurring DataForSEO pulls — the BullMQ half of
 * the design in docs/analysis/dataforseo.md.
 *
 * One BullMQ job scheduler per project, upserted with `every: <cadence>` —
 * an interval, not a calendar pattern ("next run ≈ last completion +
 * interval"). `next_run_at` is ALSO stored on the schedule row (unlike
 * Technical Audit / Social Activity): the tick honors it, so a missed
 * interval never fires a backlog of catch-up runs, and the next due time
 * is inspectable without reading Redis. The row is advanced before the
 * collect runs, so a crashed tick doesn't hot-loop.
 *
 * A recurrence carries no snapshot of its own: at fire time the worker
 * re-reads the schedule row, and fires nothing unless the project opted
 * into spend (`spendOptIn`) — scheduled pulls must never spend without
 * opt-in, so the absence of approval means no rows, not skipped rows.
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { DataforseoCadence } from '../../../generated/prisma/enums.js';
import {
  DATAFORSEO_QUEUE,
  DATAFORSEO_SCHEDULED_JOB,
  DATAFORSEO_SCHEDULED_JOB_OPTIONS,
  type DataforseoScheduledJobData,
} from '../queue/dataforseo.queue.js';
import { DATASETS } from '../dataforseo.types.js';
import { DataforseoService } from './dataforseo.service.js';

export const DATAFORSEO_WEEK_MS = 7 * 86_400_000;
export const DATAFORSEO_MONTH_MS = 30 * 86_400_000;

function schedulerId(scheduleId: string): string {
  return `dataforseo-schedule-${scheduleId}`;
}

/**
 * Interval a cadence schedules at, or null when it schedules nothing.
 * Exported for tests — the cadence→ms mapping lives in exactly one place.
 */
export function cadenceIntervalMs(cadence: DataforseoCadence): number | null {
  switch (cadence) {
    case 'WEEKLY':
      return DATAFORSEO_WEEK_MS;
    case 'MONTHLY':
      return DATAFORSEO_MONTH_MS;
    case 'MANUAL_ONLY':
      return null;
  }
}

export interface DataforseoScheduleInput {
  cadence: DataforseoCadence;
  datasets?: string[];
  spendOptIn?: boolean;
}

@Injectable()
export class DataforseoScheduler {
  private readonly logger = new Logger(DataforseoScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dataforseo: DataforseoService,
    @InjectQueue(DATAFORSEO_QUEUE) private readonly queue: Queue<DataforseoScheduledJobData>,
  ) {}

  /** Set (or replace) a project's cadence + config. `MANUAL_ONLY` removes the recurrence. */
  async setSchedule(clientId: string, projectId: string, input: DataforseoScheduleInput) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null }, select: { id: true } });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    const intervalMs = cadenceIntervalMs(input.cadence);
    const schedule = await this.prisma.dataforseoSchedule.upsert({
      where: { projectId },
      create: {
        projectId,
        cadence: input.cadence,
        active: input.cadence !== 'MANUAL_ONLY',
        datasets: input.datasets ?? [],
        nextRunAt: intervalMs === null ? null : new Date(Date.now() + intervalMs),
        spendOptIn: input.spendOptIn ?? false,
      },
      update: {
        cadence: input.cadence,
        active: input.cadence !== 'MANUAL_ONLY',
        ...(input.datasets !== undefined ? { datasets: input.datasets } : {}),
        nextRunAt: intervalMs === null ? null : new Date(Date.now() + intervalMs),
        ...(input.spendOptIn !== undefined ? { spendOptIn: input.spendOptIn } : {}),
      },
    });

    if (input.cadence === 'MANUAL_ONLY') {
      await this.removeRecurrence(schedule.id);
    } else {
      await this.queue.upsertJobScheduler(
        schedulerId(schedule.id),
        { every: intervalMs! },
        { name: DATAFORSEO_SCHEDULED_JOB, data: { projectId, reason: 'scheduled' }, opts: DATAFORSEO_SCHEDULED_JOB_OPTIONS },
      );
      this.logger.log(`DataForSEO schedule for project ${projectId}: ${input.cadence}.`);
    }

    return schedule;
  }

  /** The project's current schedule, or null when none was ever set. */
  async getSchedule(clientId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null }, select: { id: true } });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }
    return this.prisma.dataforseoSchedule.findUnique({ where: { projectId } });
  }

  /**
   * Resolve one scheduled tick: no opt-in → `'skipped'` (no rows, no
   * spend); not yet due per `next_run_at` → `'skipped'` (a missed
   * interval never catches up — the row advances instead). Otherwise the
   * row's `next_run_at` advances first, then the collect runs for the
   * schedule's datasets (empty = module defaults).
   */
  async fireScheduledTick(projectId: string) {
    const schedule = await this.prisma.dataforseoSchedule.findUnique({ where: { projectId } });
    if (!schedule || !schedule.active || schedule.cadence === 'MANUAL_ONLY' || !schedule.spendOptIn) {
      return 'skipped' as const;
    }
    if (schedule.nextRunAt && schedule.nextRunAt.getTime() > Date.now()) {
      return 'skipped' as const;
    }
    const project = await this.prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true, clientId: true } });
    if (!project || !project.clientId) return 'skipped' as const;

    const intervalMs = cadenceIntervalMs(schedule.cadence);
    await this.prisma.dataforseoSchedule.update({
      where: { projectId },
      data: { nextRunAt: intervalMs === null ? null : new Date(Date.now() + intervalMs) },
    });

    const datasets = schedule.datasets.length > 0 ? schedule.datasets : [...DATASETS];
    return this.dataforseo.collectNow(project.clientId, projectId, datasets);
  }

  private async removeRecurrence(scheduleId: string): Promise<void> {
    try {
      await this.queue.removeJobScheduler(schedulerId(scheduleId));
    } catch (err) {
      this.logger.warn(`Could not remove dataforseo scheduler ${scheduleId}: ${(err as Error).message}`);
    }
  }
}
