import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSION_KEY } from '../../../common/decorators/require-permission.decorator.js';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { Role } from '../../../generated/prisma/enums.js';
import { DataforseoScheduler } from '../services/dataforseo.scheduler.js';
import { DataforseoService } from '../services/dataforseo.service.js';
import { DataforseoController, DataforseoSnapshotController } from './dataforseo.controller.js';

describe('DataforseoController', () => {
  let controller: DataforseoController;
  let snapshotController: DataforseoSnapshotController;
  let dataforseo: {
    collectNow: ReturnType<typeof vi.fn>;
    listSnapshots: ReturnType<typeof vi.fn>;
    getSnapshot: ReturnType<typeof vi.fn>;
  };
  let schedules: { setSchedule: ReturnType<typeof vi.fn>; getSchedule: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    dataforseo = { collectNow: vi.fn(), listSnapshots: vi.fn(), getSnapshot: vi.fn() };
    schedules = { setSchedule: vi.fn(), getSchedule: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [DataforseoController, DataforseoSnapshotController],
      providers: [
        { provide: DataforseoService, useValue: dataforseo },
        { provide: DataforseoScheduler, useValue: schedules },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(DataforseoController);
    snapshotController = moduleRef.get(DataforseoSnapshotController);
  });

  it('collectNow passes scope + datasets through', async () => {
    await controller.collectNow('client-1', 'project-1', { datasets: ['serp-ranks'] });
    expect(dataforseo.collectNow).toHaveBeenCalledWith('client-1', 'project-1', ['serp-ranks']);
  });

  it('reads pass scope through', async () => {
    await controller.listSnapshots('client-1', 'project-1', 'serp-ranks');
    expect(dataforseo.listSnapshots).toHaveBeenCalledWith('client-1', 'project-1', 'serp-ranks');
    await controller.getSchedule('client-1', 'project-1');
    expect(schedules.getSchedule).toHaveBeenCalledWith('client-1', 'project-1');
    await snapshotController.getSnapshot('client-1', 'snap-1');
    expect(dataforseo.getSnapshot).toHaveBeenCalledWith('client-1', 'snap-1');
  });

  it('setSchedule passes the whole body through', async () => {
    const dto = { cadence: 'WEEKLY' as const, datasets: ['serp-ranks'], spendOptIn: true };
    await controller.setSchedule('client-1', 'project-1', dto);
    expect(schedules.setSchedule).toHaveBeenCalledWith('client-1', 'project-1', dto);
  });

  describe('guards', () => {
    /** Handler function by name — indexed access keeps the method bound to the linter. */
    function handler(controller: object, name: string): object {
      const found = (Object.getPrototypeOf(controller) as Record<string, object>)[name];
      if (!found) throw new Error(`missing handler ${name}`);
      return found;
    }

    it('collect + setSchedule are ADMIN-only', () => {
      expect(Reflect.getMetadata(ROLES_KEY, handler(controller, 'collectNow'))).toEqual([Role.ADMIN]);
      expect(Reflect.getMetadata(ROLES_KEY, handler(controller, 'setSchedule'))).toEqual([Role.ADMIN]);
    });

    it('reads require view_projects, never ADMIN', () => {
      expect(Reflect.getMetadata(PERMISSION_KEY, handler(controller, 'listSnapshots'))).toBe('view_projects');
      expect(Reflect.getMetadata(PERMISSION_KEY, handler(controller, 'getSchedule'))).toBe('view_projects');
      expect(Reflect.getMetadata(PERMISSION_KEY, handler(snapshotController, 'getSnapshot'))).toBe('view_projects');
      expect(Reflect.getMetadata(ROLES_KEY, handler(controller, 'listSnapshots'))).toBeUndefined();
      expect(Reflect.getMetadata(ROLES_KEY, handler(snapshotController, 'getSnapshot'))).toBeUndefined();
    });
  });
});
