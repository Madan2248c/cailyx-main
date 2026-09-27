import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../test/mocks/prisma.mock.js';
import { CompetitorService } from './competitor.service.js';

describe('CompetitorService', () => {
  let service: CompetitorService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = createPrismaMock();
    const moduleRef = await Test.createTestingModule({
      providers: [CompetitorService, { provide: PrismaService, useValue: asPrismaService(prisma) }],
    }).compile();
    service = moduleRef.get(CompetitorService);
  });

  it('create 404s when the project is not the caller client', async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(service.create('client-1', 'project-1', { name: 'Rival' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('create makes a manual tracked row', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    prisma.competitor.create.mockResolvedValue({ id: 'c1' });
    await service.create('client-1', 'project-1', { name: 'Rival' });
    expect(prisma.competitor.create).toHaveBeenCalledWith({
      data: { projectId: 'project-1', name: 'Rival', domain: undefined, status: 'tracked', source: 'manual' },
    });
  });

  it('recordCandidate never overwrites an existing row', async () => {
    prisma.competitor.findFirst.mockResolvedValue({ id: 'c1', name: 'Rival', status: 'tracked' });
    await service.recordCandidate('project-1', 'Rival');
    expect(prisma.competitor.create).not.toHaveBeenCalled();
  });

  it('recordCandidate inserts a new candidate row for an unseen name', async () => {
    prisma.competitor.findFirst.mockResolvedValue(null);
    await service.recordCandidate('project-1', 'New Name');
    expect(prisma.competitor.create).toHaveBeenCalledWith({
      data: { projectId: 'project-1', name: 'New Name', status: 'candidate', source: 'stance_discovered' },
    });
  });

  it('knownNames returns every row regardless of status — tracked and candidate both count', async () => {
    prisma.competitor.findMany.mockResolvedValue([{ name: 'A' }, { name: 'B' }]);
    expect(await service.knownNames('project-1')).toEqual(['A', 'B']);
  });

  it('setStatus 404s on a competitor outside the caller client', async () => {
    prisma.competitor.findFirst.mockResolvedValue(null);
    await expect(service.setStatus('client-1', 'c1', 'tracked')).rejects.toBeInstanceOf(NotFoundException);
  });
});
