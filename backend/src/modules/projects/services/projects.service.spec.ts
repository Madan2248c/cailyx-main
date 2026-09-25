import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { Role } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../test/mocks/prisma.mock.js';
import { ProjectsService } from './projects.service.js';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let prisma: PrismaMock;

  const admin = { sub: 'admin-1', role: Role.ADMIN, clientId: null };
  const poc = { sub: 'poc-1', role: Role.CLIENT_POC, clientId: 'client-1' };
  const otherPoc = { sub: 'poc-2', role: Role.CLIENT_POC, clientId: 'client-2' };

  const client = { id: 'client-1', deletedAt: null };

  beforeEach(async () => {
    prisma = createPrismaMock();

    const moduleRef = await Test.createTestingModule({
      providers: [ProjectsService, { provide: PrismaService, useValue: asPrismaService(prisma) }],
    }).compile();

    service = moduleRef.get(ProjectsService);
  });

  describe('createProject', () => {
    it('normalizes the domain and creates the project', async () => {
      prisma.client.findFirst.mockResolvedValue(client);
      prisma.project.findFirst.mockResolvedValue(null);
      prisma.project.create.mockResolvedValue({
        id: 'project-1',
        clientId: 'client-1',
        name: 'Acme',
        domain: 'acme.com',
        createdAt: new Date(),
      });

      await service.createProject('client-1', { name: 'Acme', domain: 'https://WWW.Acme.com/pricing' }, 'admin-1');

      expect(prisma.project.findFirst).toHaveBeenCalledWith({
        where: { clientId: 'client-1', domain: 'acme.com', deletedAt: null },
      });
      expect(prisma.project.create).toHaveBeenCalledWith({
        data: { clientId: 'client-1', name: 'Acme', domain: 'acme.com', createdBy: 'admin-1' },
      });
    });

    it('rejects a duplicate active domain for the same client', async () => {
      prisma.client.findFirst.mockResolvedValue(client);
      prisma.project.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createProject('client-1', { name: 'Acme', domain: 'acme.com' }, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.project.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a missing/deleted client', async () => {
      prisma.client.findFirst.mockResolvedValue(null);

      await expect(
        service.createProject('missing', { name: 'Acme', domain: 'acme.com' }, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listProjects', () => {
    it('lets ADMIN list any client', async () => {
      prisma.client.findFirst.mockResolvedValue(client);
      prisma.project.findMany.mockResolvedValue([]);

      await expect(service.listProjects('client-1', admin)).resolves.toEqual([]);
    });

    it('lets a POC list their own client', async () => {
      prisma.client.findFirst.mockResolvedValue(client);
      prisma.project.findMany.mockResolvedValue([]);

      await expect(service.listProjects('client-1', poc)).resolves.toEqual([]);
    });

    it('forbids a POC from listing a different client', async () => {
      prisma.client.findFirst.mockResolvedValue(client);

      await expect(service.listProjects('client-1', otherPoc)).rejects.toThrow(ForbiddenException);
      expect(prisma.project.findMany).not.toHaveBeenCalled();
    });
  });

  describe('archiveProject', () => {
    it('soft-deletes the project', async () => {
      prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });

      const result = await service.archiveProject('client-1', 'project-1');

      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'project-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(result).toEqual({ success: true });
    });

    it('throws NotFoundException when the project does not belong to the client or is already gone', async () => {
      prisma.project.findFirst.mockResolvedValue(null);

      await expect(service.archiveProject('client-1', 'project-1')).rejects.toThrow(NotFoundException);
    });
  });
});
