/**
 * Schedule manager for recurring technical audits — the BullMQ half of the
 * "Scheduling" design in docs/analysis/technical-audit.md.
 *
 * The old repo ran this as an in-process `@nestjs/schedule` cron because that
 * deployment had no Redis (its own header says BullMQ was the *preferred*
 * path when available). We have Redis + BullMQ already, so a schedule is one
 * BullMQ job scheduler per project, upserted with `every: <cadence in ms>`
 * — an interval, not a calendar pattern, because the required semantic is
 * "next run ≈ last completion + interval": a scheduler that was down for a
 * day must resume its cadence, not fire a backlog of catch-up runs.
 *
 * Whether BullMQ's own `every` already measures from actual completion time
 * or from the previous scheduled time regardless of when the job ran is
 * flagged in the analysis doc as needing empirical confirmation. The design
 * here does not depend on the answer: a recurrence carries no run row, and
 * the worker creates the run at fire time and skips when a run is already
 * active — so a late fire can never stack two audits for one project, and a
 * failing site advances normally instead of retrying forever.
 *
 * No `next_run_at` is stored in Postgres — BullMQ's job scheduler tracks
 * that; duplicating it would leave two sources of truth. Never two audits
 * for the same project concurrently (the worker's `startRun` returns the
 * active row instead of creating a second one), and audits run one at a
 * time site-wide (the processor's concurrency is 1).
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { AuditCadence } from '../../../generated/prisma/enums.js';
import {
  TECHNICAL_AUDIT_QUEUE,
  TECHNICAL_AUDIT_SCHEDULED_JOB,
  TECHNICAL_AUDIT_SCHEDULED_JOB_OPTIONS,
  type TechnicalAuditScheduledJobData,
} from '../queue/technical-audit.queue.js';

const WEEK_MS = 7 * 86_400_000;
const MONTH_MS = 30 * 86_400_000;

function schedulerId(scheduleId: string): string {
  return `technical-audit-schedule-${scheduleId}`;
}

@Injectable()
export class TechnicalAuditScheduler {
  private readonly logger = new Logger(TechnicalAuditScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(TECHNICAL_AUDIT_QUEUE) private readonly queue: Queue<TechnicalAuditScheduledJobData>,
  ) {}

  /** Set (or replace) a project's cadence. `MANUAL_ONLY` removes the recurrence. */
  async setSchedule(clientId: string, projectId: string, cadence: AuditCadence) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null }, select: { id: true } });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    const schedule = await this.prisma.technicalAuditSchedule.upsert({
      where: { projectId },
      create: { projectId, cadence, active: cadence !== 'MANUAL_ONLY' },
      update: { cadence, active: cadence !== 'MANUAL_ONLY' },
    });

    if (cadence === 'MANUAL_ONLY') {
      await this.removeRecurrence(schedule.id);
    } else {
      await this.queue.upsertJobScheduler(
        schedulerId(schedule.id),
        { every: cadence === 'WEEKLY' ? WEEK_MS : MONTH_MS },
        { name: TECHNICAL_AUDIT_SCHEDULED_JOB, data: { projectId, reason: 'scheduled' }, opts: TECHNICAL_AUDIT_SCHEDULED_JOB_OPTIONS },
      );
      this.logger.log(`Technical audit schedule for project ${projectId}: ${cadence}.`);
    }

    return schedule;
  }

  /** The project's current schedule, or null when none was ever set. */
  async getSchedule(clientId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null }, select: { id: true } });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }
    return this.prisma.technicalAuditSchedule.findUnique({ where: { projectId } });
  }

  private async removeRecurrence(scheduleId: string): Promise<void> {
    try {
      await this.queue.removeJobScheduler(schedulerId(scheduleId));
    } catch (err) {
      this.logger.warn(`Could not remove technical audit scheduler ${scheduleId}: ${(err as Error).message}`);
    }
  }
}
