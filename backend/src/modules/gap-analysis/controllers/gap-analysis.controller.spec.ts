import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { GapAnalysisService } from '../services/gap-analysis.service.js';
import { GapAnalysisController, GapAnalysisRecommendationController, GapAnalysisRunController } from './gap-analysis.controller.js';

describe('GapAnalysisController', () => {
  let controller: GapAnalysisController;
  let runController: GapAnalysisRunController;
  let recController: GapAnalysisRecommendationController;
  let gapAnalysis: { run: ReturnType<typeof vi.fn>; listRuns: ReturnType<typeof vi.fn>; getRun: ReturnType<typeof vi.fn>; setRecommendationStatus: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    gapAnalysis = { run: vi.fn(), listRuns: vi.fn(), getRun: vi.fn(), setRecommendationStatus: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [GapAnalysisController, GapAnalysisRunController, GapAnalysisRecommendationController],
      providers: [{ provide: GapAnalysisService, useValue: gapAnalysis }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(GapAnalysisController);
    runController = moduleRef.get(GapAnalysisRunController);
    recController = moduleRef.get(GapAnalysisRecommendationController);
  });

  it('run and listRuns pass scope through', async () => {
    await controller.run('client-1', 'project-1');
    expect(gapAnalysis.run).toHaveBeenCalledWith('client-1', 'project-1');
    await controller.listRuns('client-1', 'project-1');
    expect(gapAnalysis.listRuns).toHaveBeenCalledWith('client-1', 'project-1');
  });

  it('run-id-scoped getRun delegates with client + id', async () => {
    await runController.getRun('client-1', 'run-1');
    expect(gapAnalysis.getRun).toHaveBeenCalledWith('client-1', 'run-1');
  });

  it('recommendation status update delegates with client + id + status', async () => {
    await recController.setStatus('client-1', 'rec-1', { status: 'DONE' });
    expect(gapAnalysis.setRecommendationStatus).toHaveBeenCalledWith('client-1', 'rec-1', 'DONE');
  });
});
