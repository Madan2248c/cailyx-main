import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../test/mocks/prisma.mock.js';
import { AeoAuditReportCollector } from '../collectors/aeo-audit.collector.js';
import { CompetitorsReportCollector } from '../collectors/competitors.collector.js';
import { GapAnalysisReportCollector } from '../collectors/gap-analysis.collector.js';
import { SocialActivityCollector } from '../collectors/social-activity.collector.js';
import { TechnicalAuditCollector } from '../collectors/technical-audit.collector.js';
import { ReportNarrativeService } from './report-narrative.service.js';
import { ReportRenderService } from './report-render.service.js';
import { ReportingService } from './reporting.service.js';

/** The admin controls on a report: edit what it says, and publish it from any state. */
describe('ReportingService admin controls', () => {
  let service: ReportingService;
  let prisma: PrismaMock;

  const report = (over: Record<string, unknown> = {}) => ({
    id: 'report-1', projectId: 'project-1', kind: 'MONTHLY', status: 'DRAFT', title: 'Acme: Monthly Report', executiveSummary: 'Old', releasedRevisionId: null, ...over,
  });
  const revision = (n: number, summary = 'Old') => ({ id: `rev-${n}`, reportId: 'report-1', revisionNumber: n, contentSnapshot: { executiveSummary: summary, meta: {} } });

  beforeEach(async () => {
    prisma = createPrismaMock();
    const collector = () => ({ collect: vi.fn().mockResolvedValue(null) });
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportingService,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: TechnicalAuditCollector, useValue: collector() },
        { provide: SocialActivityCollector, useValue: collector() },
        { provide: AeoAuditReportCollector, useValue: collector() },
        { provide: CompetitorsReportCollector, useValue: collector() },
        { provide: GapAnalysisReportCollector, useValue: collector() },
        { provide: ReportNarrativeService, useValue: { write: vi.fn() } },
        { provide: ReportRenderService, useValue: { render: vi.fn() } },
      ],
    }).compile();
    service = moduleRef.get(ReportingService);
  });

  describe('edit', () => {
    it('needs something to change', async () => {
      await expect(service.edit('client-1', 'report-1', {})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('saves a draft edit as a NEW revision and leaves the old one intact', async () => {
      prisma.report.findFirst.mockResolvedValue(report());
      prisma.reportRevision.findFirst.mockResolvedValue(revision(2));
      prisma.reportRevision.create.mockResolvedValue({ id: 'rev-3' });
      prisma.report.findUniqueOrThrow.mockResolvedValue(report());

      await service.edit('client-1', 'report-1', { executiveSummary: 'New words' });

      expect(prisma.reportRevision.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ reportId: 'report-1', revisionNumber: 3, contentSnapshot: expect.objectContaining({ executiveSummary: 'New words' }) }),
      });
      const update = prisma.report.update.mock.calls[0][0];
      expect(update.data).toMatchObject({ executiveSummary: 'New words' });
      expect(update.data).not.toHaveProperty('releasedRevisionId');
    });

    it('points a LIVE report at the new revision so the client sees the edit at once', async () => {
      prisma.report.findFirst.mockResolvedValue(report({ status: 'RELEASED', releasedRevisionId: 'rev-1' }));
      prisma.reportRevision.findUnique.mockResolvedValue(revision(1));
      prisma.reportRevision.findFirst.mockResolvedValue(revision(1));
      prisma.reportRevision.create.mockResolvedValue({ id: 'rev-2' });
      prisma.report.findUniqueOrThrow.mockResolvedValue(report());

      await service.edit('client-1', 'report-1', { title: '  Better title ' });

      expect(prisma.report.update.mock.calls[0][0].data).toMatchObject({ title: 'Better title', releasedRevisionId: 'rev-2' });
    });
  });

  describe('publish', () => {
    it('releases the newest revision of a draft without the review step', async () => {
      prisma.report.findFirst.mockResolvedValue(report());
      prisma.reportRevision.findFirst.mockResolvedValue(revision(4));
      prisma.reportRevision.findUnique.mockResolvedValue(revision(4));
      prisma.report.findUniqueOrThrow.mockResolvedValue(report());

      await service.publish('client-1', 'report-1');

      expect(prisma.report.update).toHaveBeenCalledWith({
        where: { id: 'report-1' },
        data: { status: 'RELEASED', releasedRevisionId: 'rev-4', releasedAt: expect.any(Date) },
      });
    });

    it('republishes a withdrawn report', async () => {
      prisma.report.findFirst.mockResolvedValue(report({ status: 'WITHDRAWN', releasedRevisionId: 'rev-1' }));
      prisma.reportRevision.findFirst.mockResolvedValue(revision(2));
      prisma.reportRevision.findUnique.mockResolvedValue(revision(2));
      prisma.report.findUniqueOrThrow.mockResolvedValue(report());

      await service.publish('client-1', 'report-1');
      expect(prisma.report.update.mock.calls[0][0].data).toMatchObject({ status: 'RELEASED', releasedRevisionId: 'rev-2' });
    });

    it('409s when it is already live', async () => {
      prisma.report.findFirst.mockResolvedValue(report({ status: 'RELEASED' }));
      await expect(service.publish('client-1', 'report-1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.report.update).not.toHaveBeenCalled();
    });

    it('409s when there is no content to publish', async () => {
      prisma.report.findFirst.mockResolvedValue(report());
      prisma.reportRevision.findFirst.mockResolvedValue(null);
      await expect(service.publish('client-1', 'report-1')).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
