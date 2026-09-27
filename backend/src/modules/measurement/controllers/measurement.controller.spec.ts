import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { MeasurementService } from '../services/measurement.service.js';
import { MeasurementController, MeasurementRunController } from './measurement.controller.js';

describe('MeasurementController', () => {
  let controller: MeasurementController;
  let runController: MeasurementRunController;
  let measurement: {
    createRun: ReturnType<typeof vi.fn>;
    listRuns: ReturnType<typeof vi.fn>;
    summary: ReturnType<typeof vi.fn>;
    executeRun: ReturnType<typeof vi.fn>;
    getRun: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    measurement = { createRun: vi.fn(), listRuns: vi.fn(), summary: vi.fn(), executeRun: vi.fn(), getRun: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [MeasurementController, MeasurementRunController],
      providers: [{ provide: MeasurementService, useValue: measurement }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(MeasurementController);
    runController = moduleRef.get(MeasurementRunController);
  });

  it('createRun passes body through', async () => {
    const dto = { querySetId: 'qs-1', surface: 'mock' as const };
    await controller.createRun('client-1', 'project-1', dto);
    expect(measurement.createRun).toHaveBeenCalledWith('client-1', 'project-1', dto);
  });

  it('listRuns and summary pass scope through', async () => {
    await controller.listRuns('client-1', 'project-1', 'mock');
    expect(measurement.listRuns).toHaveBeenCalledWith('client-1', 'project-1', 'mock');
    await controller.summary('client-1', 'project-1', 'run-1');
    expect(measurement.summary).toHaveBeenCalledWith('client-1', 'project-1', 'run-1');
  });

  it('run-id-scoped routes delegate with client + runId', async () => {
    await runController.execute('client-1', 'run-1');
    expect(measurement.executeRun).toHaveBeenCalledWith('run-1');
    await runController.getRun('client-1', 'run-1');
    expect(measurement.getRun).toHaveBeenCalledWith('client-1', 'run-1');
  });
});
