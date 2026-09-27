import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../test/mocks/prisma.mock.js';
import { AeoAuditService } from '../../aeo-audit/services/aeo-audit.service.js';
import { CompetitorsService } from './competitors.service.js';
import { HomepageProfilerService } from './homepage-profiler.service.js';
import { SerpDiscoveryService } from './serp-discovery.service.js';

describe('CompetitorsService', () => {
  let service: CompetitorsService;
  let prisma: PrismaMock;
  let serpDiscovery: { discover: ReturnType<typeof vi.fn> };
  let profiler: { profile: ReturnType<typeof vi.fn> };
  let aeoAudit: { list: ReturnType<typeof vi.fn>; getVerdict: ReturnType<typeof vi.fn> };

  const project = { id: 'project-1', clientId: 'client-1', deletedAt: null, name: 'Acme', domain: 'acme.io' };

  beforeEach(async () => {
    prisma = createPrismaMock();
    serpDiscovery = { discover: vi.fn() };
    profiler = { profile: vi.fn() };
    aeoAudit = { list: vi.fn(), getVerdict: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CompetitorsService,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: SerpDiscoveryService, useValue: serpDiscovery },
        { provide: HomepageProfilerService, useValue: profiler },
        { provide: AeoAuditService, useValue: aeoAudit },
      ],
    }).compile();
    service = moduleRef.get(CompetitorsService);
  });

  describe('discover', () => {
    it('404s when the project is not the caller client', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(service.discover('client-1', 'project-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('upserts newly-discovered domains, never duplicates an existing one, and profiles own + every competitor', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      serpDiscovery.discover.mockResolvedValue({ domains: ['new-rival.com', 'already-tracked.com'], queriesRun: 2, costUsd: 0.004, skipped: null });
      prisma.competitor.findFirst.mockImplementation((args: { where: { domain: string } }) =>
        Promise.resolve(args.where.domain === 'already-tracked.com' ? { id: 'existing' } : null),
      );
      prisma.competitor.create.mockResolvedValue({ id: 'c-new' });
      prisma.competitor.findMany.mockResolvedValue([{ id: 'c1', domain: 'rival.com' }, { id: 'c2', domain: null }]);
      profiler.profile.mockResolvedValue({ techStackFindings: [], schemaTypes: [], seoScore: 80, seoIssues: [], reviewRating: null, fetchStatus: 'OK', error: null });

      const result = await service.discover('client-1', 'project-1');

      expect(prisma.competitor.create).toHaveBeenCalledTimes(1); // only the genuinely new domain
      expect(result.competitorsDiscovered).toBe(1);
      // own domain + c1 (has a domain) profiled; c2 (no domain) skipped
      expect(profiler.profile).toHaveBeenCalledWith('acme.io');
      expect(profiler.profile).toHaveBeenCalledWith('rival.com');
      expect(result.competitorsProfiled).toBe(1);
      expect(result.ownDomainProfiled).toBe(true);
    });
  });

  describe('create', () => {
    it('404s outside the caller client', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(service.create('client-1', 'project-1', { name: 'Rival' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates a manual tracked row', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.competitor.create.mockResolvedValue({ id: 'c1' });
      await service.create('client-1', 'project-1', { name: 'Rival', domain: 'rival.com' });
      expect(prisma.competitor.create).toHaveBeenCalledWith({
        data: { projectId: 'project-1', name: 'Rival', domain: 'rival.com', status: 'tracked', source: 'manual' },
      });
    });
  });

  describe('getGap', () => {
    it('separates the own-domain row (competitorId: null, no AEO standing) from tracked competitors', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      aeoAudit.list.mockResolvedValue([{ id: 'audit-1', status: 'completed' }]);
      aeoAudit.getVerdict.mockResolvedValue({ counted: { competitorStanding: [{ name: 'Rival Co', timesAhead: 1, timesBehind: 2, coMentions: 3 }] } });
      prisma.competitorProfile.findFirst.mockImplementation((args: { where: { competitorId: string | null } }) =>
        Promise.resolve(args.where.competitorId === null ? { seoScore: 90, fetchStatus: 'OK', techStackFindings: [], schemaTypes: [], seoIssues: [], reviewRating: null } : { seoScore: 60, fetchStatus: 'OK', techStackFindings: [], schemaTypes: [], seoIssues: [], reviewRating: null }),
      );
      prisma.competitor.findMany.mockResolvedValue([{ id: 'c1', name: 'Rival Co', domain: 'rival.com' }]);

      const gap = await service.getGap('client-1', 'project-1');

      expect(gap.own.competitorId).toBeNull();
      expect(gap.own.aeoStanding).toBeNull();
      expect(gap.own.profile?.seoScore).toBe(90);
      expect(gap.competitors[0]!.aeoStanding).toEqual({ name: 'Rival Co', timesAhead: 1, timesBehind: 2, coMentions: 3 });
      expect(gap.competitors[0]!.profile?.seoScore).toBe(60);
    });

    it('leaves aeoStanding null when no completed AEO audit exists', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      aeoAudit.list.mockResolvedValue([]);
      prisma.competitorProfile.findFirst.mockResolvedValue(null);
      prisma.competitor.findMany.mockResolvedValue([{ id: 'c1', name: 'Rival Co', domain: 'rival.com' }]);

      const gap = await service.getGap('client-1', 'project-1');
      expect(gap.competitors[0]!.aeoStanding).toBeNull();
      expect(aeoAudit.getVerdict).not.toHaveBeenCalled();
    });

    it('only compares status: tracked competitors, not untracked candidates', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      aeoAudit.list.mockResolvedValue([]);
      prisma.competitorProfile.findFirst.mockResolvedValue(null);
      prisma.competitor.findMany.mockResolvedValue([]);

      await service.getGap('client-1', 'project-1');
      expect(prisma.competitor.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'tracked' }) }));
    });
  });
});
