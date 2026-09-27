import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { CompetitorsService } from '../services/competitors.service.js';
import { CompetitorsController } from './competitors.controller.js';

describe('CompetitorsController', () => {
  let controller: CompetitorsController;
  let competitors: { discover: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn>; getGap: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    competitors = { discover: vi.fn(), create: vi.fn(), list: vi.fn(), getGap: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [CompetitorsController],
      providers: [{ provide: CompetitorsService, useValue: competitors }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(CompetitorsController);
  });

  it('discover, create, list, and getGap all pass scope through', async () => {
    await controller.discover('client-1', 'project-1');
    expect(competitors.discover).toHaveBeenCalledWith('client-1', 'project-1');
    await controller.create('client-1', 'project-1', { name: 'Rival' });
    expect(competitors.create).toHaveBeenCalledWith('client-1', 'project-1', { name: 'Rival' });
    await controller.list('client-1', 'project-1');
    expect(competitors.list).toHaveBeenCalledWith('client-1', 'project-1');
    await controller.getGap('client-1', 'project-1');
    expect(competitors.getGap).toHaveBeenCalledWith('client-1', 'project-1');
  });
});
