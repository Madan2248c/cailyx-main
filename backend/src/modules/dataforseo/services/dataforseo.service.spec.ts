import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../test/mocks/prisma.mock.js';
import { MockDataforseoAdapter } from '../adapters/mock.adapter.js';
import { DataforseoService } from './dataforseo.service.js';

/**
 * The orchestrator's decisions: unknown datasets 400 before anything is
 * stored; the mock gate fails the whole collect closed (503, no partial
 * rows); snapshots are append-only (create-only — no update/delete path
 * exists); the cost cap stops between datasets and reports the skipped.
 */
describe('DataforseoService', () => {
  let service: DataforseoService;
  let prisma: PrismaMock;
  let configValues: Record<string, string>;

  const project = { id: 'project-1', clientId: 'client-1', deletedAt: null, domain: 'example.com' };

  beforeEach(async () => {
    prisma = createPrismaMock();
    configValues = { DATAFORSEO_ALLOW_MOCK: '1' };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DataforseoService,
        MockDataforseoAdapter,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: ConfigService, useValue: { get: vi.fn((key: string, fallback?: unknown) => configValues[key] ?? fallback) } },
      ],
    }).compile();
    service = moduleRef.get(DataforseoService);
  });

  describe('collectNow', () => {
    it('400s on unknown datasets before storing anything', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      await expect(service.collectNow('client-1', 'project-1', ['serp-ranks', 'not-a-dataset'])).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.dataforseoSnapshot.create).not.toHaveBeenCalled();
    });

    it('404s when the project is not the caller client', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(service.collectNow('client-1', 'project-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('mock selection: a disabled mock fails the whole collect closed — 503, no rows', async () => {
      delete configValues.DATAFORSEO_ALLOW_MOCK;
      prisma.project.findFirst.mockResolvedValue(project);
      await expect(service.collectNow('client-1', 'project-1', ['serp-ranks'])).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(prisma.dataforseoSnapshot.create).not.toHaveBeenCalled();
    });

    it('stores one append-only snapshot per dataset with period + cost', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.dataforseoSnapshot.create
        .mockResolvedValueOnce({ id: 'snap-1', dataset: 'serp-ranks', costUsd: 0.01 })
        .mockResolvedValueOnce({ id: 'snap-2', dataset: 'backlinks-summary', costUsd: 0.01 });

      const result = await service.collectNow('client-1', 'project-1', ['serp-ranks', 'backlinks-summary']);

      expect(result.snapshots).toHaveLength(2);
      expect(result.skipped).toEqual([]);
      expect(result.totalCostUsd).toBeCloseTo(0.02);
      for (const call of prisma.dataforseoSnapshot.create.mock.calls) {
        const data = (call[0] as { data: Record<string, unknown> }).data;
        expect(data.projectId).toBe('project-1');
        expect(data.periodStart).toBeInstanceOf(Date);
        expect(data.periodEnd).toBeInstanceOf(Date);
        expect(data.payload).toBeDefined();
      }
    });

    it('append-only: a second collect creates new rows, never updates', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.dataforseoSnapshot.create.mockResolvedValue({ id: 'snap-n', dataset: 'serp-ranks', costUsd: 0.01 });

      await service.collectNow('client-1', 'project-1', ['serp-ranks']);
      await service.collectNow('client-1', 'project-1', ['serp-ranks']);

      expect(prisma.dataforseoSnapshot.create).toHaveBeenCalledTimes(2);
      // The service exposes no update/delete path — append-only by construction.
      expect((service as unknown as Record<string, unknown>).update).toBeUndefined();
      expect((service as unknown as Record<string, unknown>).delete).toBeUndefined();
      expect((service as unknown as Record<string, unknown>).remove).toBeUndefined();
    });

    it('stores one append-only snapshot per new dataset with $0 mock cost accounting', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.dataforseoSnapshot.create.mockImplementation((args: unknown) => {
        const data = (args as { data: { dataset: string; costUsd: number } }).data;
        return Promise.resolve({ id: `snap-${data.dataset}`, dataset: data.dataset, costUsd: data.costUsd });
      });

      const result = await service.collectNow('client-1', 'project-1', [
        'backlink-rows',
        'referring-domains',
        'top-pages',
        'keyword-ideas',
        'serp-snapshot',
        'domain-overview',
      ]);

      expect(result.snapshots).toHaveLength(6);
      expect(result.skipped).toEqual([]);
      // Mock fixtures are never billed: every dataset books the flat mock
      // estimate, so the run total is 6x the per-dataset figure.
      expect(result.totalCostUsd).toBeCloseTo(0.06);
      const stored = prisma.dataforseoSnapshot.create.mock.calls.map(
        (call) => (call[0] as { data: Record<string, unknown> }).data,
      );
      expect(stored.map((d) => d.dataset)).toEqual([
        'backlink-rows',
        'referring-domains',
        'top-pages',
        'keyword-ideas',
        'serp-snapshot',
        'domain-overview',
      ]);
      for (const data of stored) {
        expect(data.costUsd).toBe(0.01);
        expect(data.payload).toBeDefined();
      }
    });

    it('stops at the cost cap between datasets and reports the skipped', async () => {
      configValues.DATAFORSEO_MAX_COST_PER_RUN_USD = '0.015';
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.dataforseoSnapshot.create.mockResolvedValue({ id: 'snap-1', dataset: 'serp-ranks', costUsd: 0.01 });

      const result = await service.collectNow('client-1', 'project-1');

      expect(result.snapshots).toHaveLength(1);
      expect(result.skipped).toEqual([
        'backlinks-summary',
        'keyword-overview',
        'backlink-rows',
        'referring-domains',
        'top-pages',
        'keyword-ideas',
        'serp-snapshot',
        'domain-overview',
      ]);
      expect(prisma.dataforseoSnapshot.create).toHaveBeenCalledTimes(1);
    });

    it('cap behavior: a zero-affordable cap collects nothing and skips every new dataset', async () => {
      configValues.DATAFORSEO_MAX_COST_PER_RUN_USD = '0.005';
      prisma.project.findFirst.mockResolvedValue(project);

      const result = await service.collectNow('client-1', 'project-1', ['backlink-rows', 'domain-overview']);

      expect(result.snapshots).toHaveLength(0);
      expect(result.skipped).toEqual(['backlink-rows', 'domain-overview']);
      expect(result.totalCostUsd).toBe(0);
      expect(prisma.dataforseoSnapshot.create).not.toHaveBeenCalled();
    });
  });

  describe('reads', () => {
    it('listSnapshots scopes to the project and passes the dataset filter', async () => {
      prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
      prisma.dataforseoSnapshot.findMany.mockResolvedValue([]);
      await service.listSnapshots('client-1', 'project-1', 'serp-ranks');
      expect(prisma.dataforseoSnapshot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ projectId: 'project-1', dataset: 'serp-ranks' }) }),
      );
    });

    it('listSnapshots passes a new-dataset filter through', async () => {
      prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
      prisma.dataforseoSnapshot.findMany.mockResolvedValue([]);
      await service.listSnapshots('client-1', 'project-1', 'backlink-rows');
      expect(prisma.dataforseoSnapshot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ projectId: 'project-1', dataset: 'backlink-rows' }) }),
      );
    });
    it('listSnapshots 400s on an unknown dataset filter', async () => {
      prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
      await expect(service.listSnapshots('client-1', 'project-1', 'nope')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('getSnapshot 404s outside the caller client', async () => {
      prisma.dataforseoSnapshot.findFirst.mockResolvedValue(null);
      await expect(service.getSnapshot('client-1', 'snap-foreign')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
