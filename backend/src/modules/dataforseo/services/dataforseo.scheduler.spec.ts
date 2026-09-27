import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../test/mocks/prisma.mock.js';
import { DATAFORSEO_MONTH_MS, DATAFORSEO_WEEK_MS, cadenceIntervalMs, DataforseoScheduler } from './dataforseo.scheduler.js';
import { DataforseoService } from './dataforseo.service.js';
import { DATAFORSEO_QUEUE } from '../queue/dataforseo.queue.js';

describe('cadenceIntervalMs', () => {
  it('maps WEEKLY to 7 days and MONTHLY to 30 days in ms', () => {
    expect(cadenceIntervalMs('WEEKLY')).toBe(DATAFORSEO_WEEK_MS);
    expect(cadenceIntervalMs('WEEKLY')).toBe(7 * 86_400_000);
    expect(cadenceIntervalMs('MONTHLY')).toBe(DATAFORSEO_MONTH_MS);
    expect(cadenceIntervalMs('MONTHLY')).toBe(30 * 86_400_000);
  });

  it('maps MANUAL_ONLY to null — it schedules nothing', () => {
    expect(cadenceIntervalMs('MANUAL_ONLY')).toBeNull();
  });
});

describe('DataforseoScheduler', () => {
  let scheduler: DataforseoScheduler;
  let prisma: PrismaMock;
  let queue: { upsertJobScheduler: ReturnType<typeof vi.fn>; removeJobScheduler: ReturnType<typeof vi.fn> };
  let dataforseo: { collectNow: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = createPrismaMock();
    queue = { upsertJobScheduler: vi.fn().mockResolvedValue({}), removeJobScheduler: vi.fn().mockResolvedValue(true) };
    dataforseo = { collectNow: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DataforseoScheduler,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: DataforseoService, useValue: dataforseo },
        { provide: getQueueToken(DATAFORSEO_QUEUE), useValue: queue },
      ],
    }).compile();
    scheduler = moduleRef.get(DataforseoScheduler);
  });

  it('WEEKLY upserts an interval scheduler and stores nextRunAt ~7d out', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    prisma.dataforseoSchedule.upsert.mockResolvedValue({ id: 'sched-1', projectId: 'project-1', cadence: 'WEEKLY' });
    const before = Date.now();

    await scheduler.setSchedule('client-1', 'project-1', { cadence: 'WEEKLY', datasets: ['serp-ranks'], spendOptIn: true });

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'dataforseo-schedule-sched-1',
      { every: 7 * 86_400_000 },
      expect.objectContaining({ name: 'scheduled-run' }),
    );
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
    const create = prisma.dataforseoSchedule.upsert.mock.calls[0]![0] as { create: { nextRunAt: Date } };
    expect(create.create.nextRunAt.getTime()).toBeGreaterThanOrEqual(before + 7 * 86_400_000);
  });

  it('MANUAL_ONLY clears nextRunAt and removes the recurrence', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    prisma.dataforseoSchedule.upsert.mockResolvedValue({ id: 'sched-1', cadence: 'MANUAL_ONLY', active: false });

    await scheduler.setSchedule('client-1', 'project-1', { cadence: 'MANUAL_ONLY' });

    expect(queue.removeJobScheduler).toHaveBeenCalledWith('dataforseo-schedule-sched-1');
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    const create = prisma.dataforseoSchedule.upsert.mock.calls[0]![0] as { create: { nextRunAt: null } };
    expect(create.create.nextRunAt).toBeNull();
  });

  it('fireScheduledTick skips without spend opt-in — no rows, no spend', async () => {
    prisma.dataforseoSchedule.findUnique.mockResolvedValue({
      id: 'sched-1',
      projectId: 'project-1',
      cadence: 'WEEKLY',
      active: true,
      spendOptIn: false,
      datasets: [],
      nextRunAt: new Date(Date.now() - 1000),
    });
    expect(await scheduler.fireScheduledTick('project-1')).toBe('skipped');
    expect(dataforseo.collectNow).not.toHaveBeenCalled();
  });

  it('fireScheduledTick skips when not yet due — the row, not the clock backlog, decides', async () => {
    prisma.dataforseoSchedule.findUnique.mockResolvedValue({
      id: 'sched-1',
      projectId: 'project-1',
      cadence: 'WEEKLY',
      active: true,
      spendOptIn: true,
      datasets: [],
      nextRunAt: new Date(Date.now() + 6 * 86_400_000),
    });
    expect(await scheduler.fireScheduledTick('project-1')).toBe('skipped');
    expect(dataforseo.collectNow).not.toHaveBeenCalled();
    expect(prisma.dataforseoSchedule.update).not.toHaveBeenCalled();
  });

  it('fireScheduledTick advances nextRunAt then collects the schedule datasets', async () => {
    prisma.dataforseoSchedule.findUnique.mockResolvedValue({
      id: 'sched-1',
      projectId: 'project-1',
      cadence: 'MONTHLY',
      active: true,
      spendOptIn: true,
      datasets: ['keyword-overview'],
      nextRunAt: new Date(Date.now() - 1000),
    });
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1', clientId: 'client-1' });
    const collected = { snapshots: [], totalCostUsd: 0, skipped: [] };
    dataforseo.collectNow.mockResolvedValue(collected);
    const before = Date.now();

    expect(await scheduler.fireScheduledTick('project-1')).toBe(collected);

    const update = prisma.dataforseoSchedule.update.mock.calls[0]![0] as { data: { nextRunAt: Date } };
    expect(update.data.nextRunAt.getTime()).toBeGreaterThanOrEqual(before + 30 * 86_400_000);
    expect(dataforseo.collectNow).toHaveBeenCalledWith('client-1', 'project-1', ['keyword-overview']);
  });

  it('fireScheduledTick falls back to every dataset when the schedule stores none', async () => {
    prisma.dataforseoSchedule.findUnique.mockResolvedValue({
      id: 'sched-1',
      projectId: 'project-1',
      cadence: 'WEEKLY',
      active: true,
      spendOptIn: true,
      datasets: [],
      nextRunAt: null,
    });
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1', clientId: 'client-1' });
    dataforseo.collectNow.mockResolvedValue({ snapshots: [], totalCostUsd: 0, skipped: [] });

    await scheduler.fireScheduledTick('project-1');

    expect(dataforseo.collectNow).toHaveBeenCalledWith('client-1', 'project-1', ['serp-ranks', 'backlinks-summary', 'keyword-overview']);
  });
});
