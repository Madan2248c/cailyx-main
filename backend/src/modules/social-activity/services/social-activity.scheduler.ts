/**
 * Schedule manager for recurring social-activity pulls — the BullMQ half of
 * the "Scheduling" design in docs/analysis/digital-presence-audit.md.
 *
 * One BullMQ job scheduler per project, upserted with `every: <cadence>` —
 * an interval, not a calendar pattern ("next run ≈ last completion +
 * interval"). A recurrence carries no run row and no spend of its own: at
 * fire time the worker re-reads the schedule row, and fires nothing unless
 * the project opted into spend (`spendOptIn`) — scheduled runs must never
 * spend without opt-in, so the absence of approval means no row, not a
 * skipped row.
 *
 * No `next_run_at` in Postgres — BullMQ tracks that. Never two runs for one
 * project concurrently (the orchestrator returns the active row).
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { SocialActivityCadence } from '../../../generated/prisma/enums.js';
import {
  SOCIAL_ACTIVITY_QUEUE,
  SOCIAL_ACTIVITY_SCHEDULED_JOB,
  SOCIAL_ACTIVITY_SCHEDULED_JOB_OPTIONS,
  type SocialActivityScheduledJobData,
} from '../queue/social-activity.queue.js';
import { SocialActivityService } from './social-activity.service.js';

const WEEK_MS = 7 * 86_400_000;
const MONTH_MS = 30 * 86_400_000;

function schedulerId(scheduleId: string): string {
  return `social-activity-schedule-${scheduleId}`;
}

export interface SocialScheduleInput {
  cadence: SocialActivityCadence;
  platforms?: string[];
  windowDays?: number;
  postsPerPlatform?: number;
  spendOptIn?: boolean;
}

@Injectable()
export class SocialActivityScheduler {
  private readonly logger = new Logger(SocialActivityScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: SocialActivityService,
    @InjectQueue(SOCIAL_ACTIVITY_QUEUE) private readonly queue: Queue<SocialActivityScheduledJobData>,
  ) {}

  /** Set (or replace) a project's cadence + config. `MANUAL_ONLY` removes the recurrence. */
  async setSchedule(clientId: string, projectId: string, input: SocialScheduleInput) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null }, select: { id: true } });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    const schedule = await this.prisma.socialActivitySchedule.upsert({
      where: { projectId },
      create: {
        projectId,
        cadence: input.cadence,
        active: input.cadence !== 'MANUAL_ONLY',
        platforms: input.platforms ?? [],
        windowDays: input.windowDays,
        postsPerPlatform: input.postsPerPlatform,
        spendOptIn: input.spendOptIn ?? false,
      },
      update: {
        cadence: input.cadence,
        active: input.cadence !== 'MANUAL_ONLY',
        ...(input.platforms !== undefined ? { platforms: input.platforms } : {}),
        ...(input.windowDays !== undefined ? { windowDays: input.windowDays } : {}),
        ...(input.postsPerPlatform !== undefined ? { postsPerPlatform: input.postsPerPlatform } : {}),
        ...(input.spendOptIn !== undefined ? { spendOptIn: input.spendOptIn } : {}),
      },
    });

    if (input.cadence === 'MANUAL_ONLY') {
      await this.removeRecurrence(schedule.id);
    } else {
      await this.queue.upsertJobScheduler(
        schedulerId(schedule.id),
        { every: input.cadence === 'WEEKLY' ? WEEK_MS : MONTH_MS },
        { name: SOCIAL_ACTIVITY_SCHEDULED_JOB, data: { projectId, reason: 'scheduled' }, opts: SOCIAL_ACTIVITY_SCHEDULED_JOB_OPTIONS },
      );
      this.logger.log(`Social activity schedule for project ${projectId}: ${input.cadence}.`);
    }

    return schedule;
  }

  /** The project's current schedule, or null when none was ever set. */
  async getSchedule(clientId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null }, select: { id: true } });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }
    return this.prisma.socialActivitySchedule.findUnique({ where: { projectId } });
  }

  /**
   * Resolve one scheduled tick: no opt-in → `'skipped'` (no row, no spend);
   * active run → `'skipped'` as well (that run has its own worker — executing
   * it here would double-execute; a missed interval never catches up).
   * Otherwise a fresh SCHEDULED row the processor executes.
   */
  async fireScheduledTick(projectId: string) {
    const schedule = await this.prisma.socialActivitySchedule.findUnique({ where: { projectId } });
    if (!schedule || !schedule.active || schedule.cadence === 'MANUAL_ONLY' || !schedule.spendOptIn) {
      return 'skipped' as const;
    }
    const active = await this.prisma.socialActivityRun.findFirst({
      where: { projectId, status: { in: ['QUEUED', 'RUNNING'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (active) return 'skipped' as const;
    const run = await this.activity.startRun(
      projectId,
      'scheduled',
      {
        platforms: (schedule.platforms.length > 0 ? schedule.platforms : undefined) as
          | ('linkedin' | 'instagram' | 'facebook' | 'x' | 'youtube' | 'tiktok')[]
          | undefined,
        postsPerPlatform: schedule.postsPerPlatform ?? undefined,
        windowDays: schedule.windowDays ?? undefined,
      },
    );
    // `startRun` returns the active row when one appeared between the checks
    // above and the create — only execute what this tick created.
    if (run.triggeredBy !== 'SCHEDULED' || run.status !== 'QUEUED') return 'skipped' as const;
    return run;
  }

  private async removeRecurrence(scheduleId: string): Promise<void> {
    try {
      await this.queue.removeJobScheduler(schedulerId(scheduleId));
    } catch (err) {
      this.logger.warn(`Could not remove social activity scheduler ${scheduleId}: ${(err as Error).message}`);
    }
  }
}
