import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../test/mocks/prisma.mock.js';
import { TECHNICAL_AUDIT_QUEUE } from '../queue/technical-audit.queue.js';
import { TechnicalAuditScheduler } from './technical-audit.scheduler.js';

describe('TechnicalAuditScheduler', () => {
  let scheduler: TechnicalAuditScheduler;
  let prisma: PrismaMock;
  let queue: { upsertJobScheduler: ReturnType<typeof vi.fn>; removeJobScheduler: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = createPrismaMock();
    queue = { upsertJobScheduler: vi.fn().mockResolvedValue({}), removeJobScheduler: vi.fn().mockResolvedValue(true) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TechnicalAuditScheduler,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: getQueueToken(TECHNICAL_AUDIT_QUEUE), useValue: queue },
      ],
    }).compile();
    scheduler = moduleRef.get(TechnicalAuditScheduler);
  });

  it('WEEKLY upserts an interval scheduler (not a calendar pattern)', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    prisma.technicalAuditSchedule.upsert.mockResolvedValue({ id: 'sched-1', projectId: 'project-1', cadence: 'WEEKLY' });

    await scheduler.setSchedule('client-1', 'project-1', 'WEEKLY');

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'technical-audit-schedule-sched-1',
      { every: 7 * 86_400_000 },
      expect.objectContaining({ name: 'scheduled-run' }),
    );
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  it('MANUAL_ONLY removes the recurrence instead of upserting', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    prisma.technicalAuditSchedule.upsert.mockResolvedValue({ id: 'sched-1', projectId: 'project-1', cadence: 'MANUAL_ONLY' });

    await scheduler.setSchedule('client-1', 'project-1', 'MANUAL_ONLY');

    expect(queue.removeJobScheduler).toHaveBeenCalledWith('technical-audit-schedule-sched-1');
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it('404s when the project belongs to another client', async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(scheduler.setSchedule('client-1', 'missing', 'WEEKLY')).rejects.toBeInstanceOf(NotFoundException);
  });
});
