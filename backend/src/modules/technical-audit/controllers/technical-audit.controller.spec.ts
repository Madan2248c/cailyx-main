import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { TechnicalAuditController } from './technical-audit.controller.js';
import { TechnicalAuditScheduler } from '../services/technical-audit.scheduler.js';
import { TechnicalAuditService } from '../services/technical-audit.service.js';

describe('TechnicalAuditController', () => {
  let controller: TechnicalAuditController;
  const audits = { rerun: vi.fn(), listRuns: vi.fn(), getTrend: vi.fn() };
  const schedules = { setSchedule: vi.fn(), getSchedule: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [TechnicalAuditController],
      providers: [
        { provide: TechnicalAuditService, useValue: audits },
        { provide: TechnicalAuditScheduler, useValue: schedules },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(TechnicalAuditController);
  });

  it('rerun delegates to the service with client + project scope', async () => {
    await controller.rerun('client-1', 'project-1');
    expect(audits.rerun).toHaveBeenCalledWith('client-1', 'project-1');
  });

  it('setSchedule passes the cadence through', async () => {
    await controller.setSchedule('client-1', 'project-1', { cadence: 'WEEKLY' });
    expect(schedules.setSchedule).toHaveBeenCalledWith('client-1', 'project-1', 'WEEKLY');
  });
});
