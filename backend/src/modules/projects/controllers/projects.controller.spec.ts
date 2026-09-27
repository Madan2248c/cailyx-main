import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { Role } from '../../../generated/prisma/enums.js';
import { ProjectsService } from '../services/projects.service.js';
import { ProjectsController } from './projects.controller.js';

describe('ProjectsController', () => {
  let controller: ProjectsController;
  let projectsService: Record<string, ReturnType<typeof vi.fn>>;

  const admin = { sub: 'admin-1', role: Role.ADMIN, clientId: null };

  beforeEach(async () => {
    projectsService = {
      createProject: vi.fn().mockResolvedValue({ id: 'project-1' }),
      listProjects: vi.fn().mockResolvedValue(['project-list']),
      archiveProject: vi.fn().mockResolvedValue({ success: true }),
      getDay1Status: vi.fn().mockResolvedValue({ id: 'pipeline-1' }),
      retryDay1Pipeline: vi.fn().mockResolvedValue({ id: 'pipeline-1' }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [{ provide: ProjectsService, useValue: projectsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(ProjectsController);
  });

  it('createProject delegates the client id, DTO, and caller id', async () => {
    const dto = { name: 'Acme', domain: 'acme.com', day1SpendConsent: true };
    await controller.createProject('client-1', dto, admin);
    expect(projectsService.createProject).toHaveBeenCalledWith('client-1', dto, admin.sub);
  });

  it('listProjects delegates the client id and caller', async () => {
    const result = await controller.listProjects('client-1', admin);
    expect(projectsService.listProjects).toHaveBeenCalledWith('client-1', admin);
    expect(result).toEqual(['project-list']);
  });

  it('archiveProject delegates the client id and project id', async () => {
    await controller.archiveProject('client-1', 'project-1');
    expect(projectsService.archiveProject).toHaveBeenCalledWith('client-1', 'project-1');
  });

  it('getDay1Status delegates the client id and project id', async () => {
    await controller.getDay1Status('client-1', 'project-1');
    expect(projectsService.getDay1Status).toHaveBeenCalledWith('client-1', 'project-1');
  });

  it('retryDay1Pipeline delegates the client id and project id', async () => {
    await controller.retryDay1Pipeline('client-1', 'project-1');
    expect(projectsService.retryDay1Pipeline).toHaveBeenCalledWith('client-1', 'project-1');
  });
});
