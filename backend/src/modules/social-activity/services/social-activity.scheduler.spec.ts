import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../test/mocks/prisma.mock.js';
import { SOCIAL_ACTIVITY_QUEUE } from '../queue/social-activity.queue.js';
import { SocialActivityScheduler } from './social-activity.scheduler.js';
import { SocialActivityService } from './social-activity.service.js';

describe('SocialActivityScheduler', () => {
  let scheduler: SocialActivityScheduler;
  let prisma: PrismaMock;
  let queue: { upsertJobScheduler: ReturnType<typeof vi.fn>; removeJobScheduler: ReturnType<typeof vi.fn> };
  let activity: { startRun: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = createPrismaMock();
    queue = { upsertJobScheduler: vi.fn().mockResolvedValue({}), removeJobScheduler: vi.fn().mockResolvedValue(true) };
    activity = { startRun: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SocialActivityScheduler,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: SocialActivityService, useValue: activity },
        { provide: getQueueToken(SOCIAL_ACTIVITY_QUEUE), useValue: queue },
      ],
    }).compile();
    scheduler = moduleRef.get(SocialActivityScheduler);
  });

  it('WEEKLY upserts an interval scheduler with stored config', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    prisma.socialActivitySchedule.upsert.mockResolvedValue({ id: 'sched-1', projectId: 'project-1', cadence: 'WEEKLY' });

    await scheduler.setSchedule('client-1', 'project-1', { cadence: 'WEEKLY', spendOptIn: true });

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'social-activity-schedule-sched-1',
      { every: 7 * 86_400_000 },
      expect.objectContaining({ name: 'scheduled-run' }),
    );
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  it('MANUAL_ONLY removes the recurrence', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    prisma.socialActivitySchedule.upsert.mockResolvedValue({ id: 'sched-1', cadence: 'MANUAL_ONLY', active: false });

    await scheduler.setSchedule('client-1', 'project-1', { cadence: 'MANUAL_ONLY' });

    expect(queue.removeJobScheduler).toHaveBeenCalledWith('social-activity-schedule-sched-1');
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it('fireScheduledTick skips without spend opt-in — no row, no spend', async () => {
    prisma.socialActivitySchedule.findUnique.mockResolvedValue({
      id: 'sched-1',
      projectId: 'project-1',
      cadence: 'WEEKLY',
      active: true,
      spendOptIn: false,
      platforms: [],
    });
    expect(await scheduler.fireScheduledTick('project-1')).toBe('skipped');
    expect(activity.startRun).not.toHaveBeenCalled();
  });

  it('fireScheduledTick skips when a run is already active', async () => {
    prisma.socialActivitySchedule.findUnique.mockResolvedValue({
      id: 'sched-1',
      projectId: 'project-1',
      cadence: 'WEEKLY',
      active: true,
      spendOptIn: true,
      platforms: [],
    });
    prisma.socialActivityRun.findFirst.mockResolvedValue({ id: 'run-9', status: 'RUNNING' });
    expect(await scheduler.fireScheduledTick('project-1')).toBe('skipped');
    expect(activity.startRun).not.toHaveBeenCalled();
  });

  it('fireScheduledTick creates a SCHEDULED row with stored config', async () => {
    prisma.socialActivitySchedule.findUnique.mockResolvedValue({
      id: 'sched-1',
      projectId: 'project-1',
      cadence: 'WEEKLY',
      active: true,
      spendOptIn: true,
      platforms: ['linkedin'],
      windowDays: 30,
      postsPerPlatform: 10,
    });
    prisma.socialActivityRun.findFirst.mockResolvedValue(null);
    const fresh = { id: 'run-2', triggeredBy: 'SCHEDULED', status: 'QUEUED' };
    activity.startRun.mockResolvedValue(fresh);

    expect(await scheduler.fireScheduledTick('project-1')).toBe(fresh);
    expect(activity.startRun).toHaveBeenCalledWith(
      'project-1',
      'scheduled',
      expect.objectContaining({ platforms: ['linkedin'], postsPerPlatform: 10, windowDays: 30 }),
    );
  });
});
