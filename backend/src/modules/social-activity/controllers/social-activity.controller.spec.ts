import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { SocialActivityScheduler } from '../services/social-activity.scheduler.js';
import { SocialActivityService } from '../services/social-activity.service.js';
import { SocialActivityController, SocialActivityRunController } from './social-activity.controller.js';

describe('SocialActivityController', () => {
  let controller: SocialActivityController;
  let runController: SocialActivityRunController;
  let activity: {
    rerun: ReturnType<typeof vi.fn>;
    listRuns: ReturnType<typeof vi.fn>;
    getRun: ReturnType<typeof vi.fn>;
    getComparison: ReturnType<typeof vi.fn>;
  };
  let schedules: { setSchedule: ReturnType<typeof vi.fn>; getSchedule: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    activity = { rerun: vi.fn(), listRuns: vi.fn(), getRun: vi.fn(), getComparison: vi.fn() };
    schedules = { setSchedule: vi.fn(), getSchedule: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [SocialActivityController, SocialActivityRunController],
      providers: [
        { provide: SocialActivityService, useValue: activity },
        { provide: SocialActivityScheduler, useValue: schedules },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(SocialActivityController);
    runController = moduleRef.get(SocialActivityRunController);
  });

  it('passes trigger scope + body through (spend gate lives in the service)', async () => {
    const dto = { confirmSpend: true as const, platforms: ['linkedin'] };
    await controller.rerun('client-1', 'project-1', dto);
    expect(activity.rerun).toHaveBeenCalledWith('client-1', 'project-1', dto);
  });

  it('passes schedule scope through', async () => {
    await controller.setSchedule('client-1', 'project-1', { cadence: 'WEEKLY', spendOptIn: true });
    expect(schedules.setSchedule).toHaveBeenCalledWith('client-1', 'project-1', {
      cadence: 'WEEKLY',
      spendOptIn: true,
    });
    await controller.getSchedule('client-1', 'project-1');
    expect(schedules.getSchedule).toHaveBeenCalledWith('client-1', 'project-1');
    await controller.listRuns('client-1', 'project-1');
    expect(activity.listRuns).toHaveBeenCalledWith('client-1', 'project-1');
  });

  it('scopes run reads to the caller client', async () => {
    await runController.getRun('client-1', 'run-1');
    expect(activity.getRun).toHaveBeenCalledWith('client-1', 'run-1');
    await runController.getComparison('client-1', 'run-1');
    expect(activity.getComparison).toHaveBeenCalledWith('client-1', 'run-1');
  });
});
