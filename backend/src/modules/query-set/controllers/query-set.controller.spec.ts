import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { QuerySetService } from '../services/query-set.service.js';
import { QuerySetController, QuerySetItemController } from './query-set.controller.js';

describe('QuerySetController', () => {
  let controller: QuerySetController;
  let itemController: QuerySetItemController;
  let querySets: {
    create: ReturnType<typeof vi.fn>;
    generate: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    export: ReturnType<typeof vi.fn>;
    getOne: ReturnType<typeof vi.fn>;
    addPrompt: ReturnType<typeof vi.fn>;
    removePrompt: ReturnType<typeof vi.fn>;
    activate: ReturnType<typeof vi.fn>;
    fork: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    querySets = {
      create: vi.fn(),
      generate: vi.fn(),
      list: vi.fn(),
      export: vi.fn(),
      getOne: vi.fn(),
      addPrompt: vi.fn(),
      removePrompt: vi.fn(),
      activate: vi.fn(),
      fork: vi.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [QuerySetController, QuerySetItemController],
      providers: [{ provide: QuerySetService, useValue: querySets }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(QuerySetController);
    itemController = moduleRef.get(QuerySetItemController);
  });

  it('generate passes the tier through', async () => {
    await controller.generate('client-1', 'project-1', { tier: 'starter' });
    expect(querySets.generate).toHaveBeenCalledWith('client-1', 'project-1', { tier: 'starter' });
  });

  it('list and export pass scope through', async () => {
    await controller.list('client-1', 'project-1', 'draft');
    expect(querySets.list).toHaveBeenCalledWith('client-1', 'project-1', 'draft');
    await controller.export('client-1', 'project-1');
    expect(querySets.export).toHaveBeenCalledWith('client-1', 'project-1');
  });

  it('set-id-scoped routes delegate with client + id', async () => {
    await itemController.getOne('client-1', 'set-1');
    expect(querySets.getOne).toHaveBeenCalledWith('client-1', 'set-1');
    await itemController.addPrompt('client-1', 'set-1', { prompt: 'hi' });
    expect(querySets.addPrompt).toHaveBeenCalledWith('client-1', 'set-1', { prompt: 'hi' });
    await itemController.removePrompt('client-1', 'set-1', 'item-1');
    expect(querySets.removePrompt).toHaveBeenCalledWith('client-1', 'set-1', 'item-1');
    await itemController.activate('client-1', 'set-1');
    expect(querySets.activate).toHaveBeenCalledWith('client-1', 'set-1');
    await itemController.fork('client-1', 'set-1');
    expect(querySets.fork).toHaveBeenCalledWith('client-1', 'set-1');
  });
});
