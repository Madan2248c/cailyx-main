import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { AeoAuditService } from '../services/aeo-audit.service.js';
import { CompetitorService } from '../services/competitor.service.js';
import { AeoAuditController, AeoAuditRunController, CompetitorController, CompetitorItemController } from './aeo-audit.controller.js';

describe('AeoAuditController', () => {
  let controller: AeoAuditController;
  let runController: AeoAuditRunController;
  let competitorController: CompetitorController;
  let competitorItemController: CompetitorItemController;
  let audits: {
    create: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    run: ReturnType<typeof vi.fn>;
    getAudit: ReturnType<typeof vi.fn>;
    getVerdict: ReturnType<typeof vi.fn>;
    regenerateNarrative: ReturnType<typeof vi.fn>;
  };
  let competitors: { list: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; setStatus: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    audits = { create: vi.fn(), list: vi.fn(), run: vi.fn(), getAudit: vi.fn(), getVerdict: vi.fn(), regenerateNarrative: vi.fn() };
    competitors = { list: vi.fn(), create: vi.fn(), setStatus: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [AeoAuditController, AeoAuditRunController, CompetitorController, CompetitorItemController],
      providers: [
        { provide: AeoAuditService, useValue: audits },
        { provide: CompetitorService, useValue: competitors },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(AeoAuditController);
    runController = moduleRef.get(AeoAuditRunController);
    competitorController = moduleRef.get(CompetitorController);
    competitorItemController = moduleRef.get(CompetitorItemController);
  });

  it('create and list pass scope + body through', async () => {
    const dto = { querySetId: 'qs-1', surfaces: ['cloro_chatgpt' as const] };
    await controller.create('client-1', 'project-1', dto);
    expect(audits.create).toHaveBeenCalledWith('client-1', 'project-1', dto);
    await controller.list('client-1', 'project-1');
    expect(audits.list).toHaveBeenCalledWith('client-1', 'project-1');
  });

  it('audit-id-scoped routes delegate with client + auditId', async () => {
    await runController.run('client-1', 'audit-1');
    expect(audits.run).toHaveBeenCalledWith('client-1', 'audit-1');
    await runController.getAudit('client-1', 'audit-1');
    expect(audits.getAudit).toHaveBeenCalledWith('client-1', 'audit-1');
    await runController.getVerdict('client-1', 'audit-1');
    expect(audits.getVerdict).toHaveBeenCalledWith('client-1', 'audit-1');
    await runController.regenerateNarrative('client-1', 'audit-1');
    expect(audits.regenerateNarrative).toHaveBeenCalledWith('client-1', 'audit-1');
  });

  it('competitor routes delegate with client/project/id scope', async () => {
    await competitorController.list('client-1', 'project-1');
    expect(competitors.list).toHaveBeenCalledWith('client-1', 'project-1');
    await competitorController.create('client-1', 'project-1', { name: 'Rival' });
    expect(competitors.create).toHaveBeenCalledWith('client-1', 'project-1', { name: 'Rival' });
    await competitorItemController.setStatus('client-1', 'c1', { status: 'tracked' });
    expect(competitors.setStatus).toHaveBeenCalledWith('client-1', 'c1', 'tracked');
  });
});
