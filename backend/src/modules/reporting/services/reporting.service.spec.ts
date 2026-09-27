import { ConflictException, NotFoundException } from '@nestjs/common';
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

/**
 * The orchestrator's decisions: DAY1 bypasses the editorial gate entirely
 * (released on generate), MONTHLY starts as DRAFT and moves through
 * review/approve; the editorial-gate endpoints 409 on a DAY1 report; a
 * missing source never blocks generation; `getBySlug` scopes to the
 * caller's own client unless they're unscoped (ADMIN, clientId null).
 */
describe('ReportingService', () => {
  let service: ReportingService;
  let prisma: PrismaMock;
  let narrative: { write: ReturnType<typeof vi.fn> };
  let renderer: { render: ReturnType<typeof vi.fn> };

  const project = { id: 'project-1', clientId: 'client-1', deletedAt: null, name: 'Acme', domain: 'acme.com' };

  beforeEach(async () => {
    prisma = createPrismaMock();
    narrative = { write: vi.fn().mockResolvedValue({ summary: 'All good.', model: 'test-model' }) };
    renderer = { render: vi.fn().mockReturnValue('<html></html>') };

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
        { provide: ReportNarrativeService, useValue: narrative },
        { provide: ReportRenderService, useValue: renderer },
      ],
    }).compile();
    service = moduleRef.get(ReportingService);
  });

  describe('generate', () => {
    it('404s when the project is not the caller client', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(service.generate('client-1', 'project-1', 'DAY1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('DAY1 is released immediately — bypasses the editorial gate', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.report.create.mockResolvedValue({ id: 'report-1' });
      prisma.reportRevision.create.mockResolvedValue({ id: 'rev-1' });
      prisma.report.findUniqueOrThrow.mockResolvedValue({ id: 'report-1', status: 'RELEASED' });

      await service.generate('client-1', 'project-1', 'DAY1');

      expect(prisma.report.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'RELEASED', releasedAt: expect.any(Date) }) }));
      expect(prisma.report.update).toHaveBeenCalledWith({ where: { id: 'report-1' }, data: { releasedRevisionId: 'rev-1' } });
    });

    it('MONTHLY starts as DRAFT — no release, no revision-id backfill', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.report.findFirst.mockResolvedValue(null); // no previous released report
      prisma.report.create.mockResolvedValue({ id: 'report-2' });
      prisma.reportRevision.create.mockResolvedValue({ id: 'rev-1' });
      prisma.report.findUniqueOrThrow.mockResolvedValue({ id: 'report-2', status: 'DRAFT' });

      await service.generate('client-1', 'project-1', 'MONTHLY');

      expect(prisma.report.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'DRAFT', releasedAt: null }) }));
      expect(prisma.report.update).not.toHaveBeenCalled();
    });

    it('a report with zero completed sources still generates — a missing source is omitted, never fabricated', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.report.create.mockResolvedValue({ id: 'report-3' });
      prisma.reportRevision.create.mockResolvedValue({ id: 'rev-1' });
      prisma.report.findUniqueOrThrow.mockResolvedValue({ id: 'report-3', status: 'RELEASED' });

      await expect(service.generate('client-1', 'project-1', 'DAY1')).resolves.toBeDefined();
      expect(prisma.report.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceTechnicalAuditRunId: null,
            sourceSocialActivityRunId: null,
            sourceAeoAuditId: null,
            sourceGapAnalysisRunId: null,
          }),
        }),
      );
    });

    it('falls back to a placeholder summary when the narrative call fails, and still generates', async () => {
      narrative.write.mockRejectedValue(new Error('llm down'));
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.report.create.mockResolvedValue({ id: 'report-4' });
      prisma.reportRevision.create.mockResolvedValue({ id: 'rev-1' });
      prisma.report.findUniqueOrThrow.mockResolvedValue({ id: 'report-4', status: 'RELEASED' });

      await service.generate('client-1', 'project-1', 'DAY1');

      expect(prisma.report.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ executiveSummary: 'Executive summary unavailable for this report.' }) }));
    });
  });

  describe('editorial lifecycle', () => {
    const day1Report = { id: 'report-1', kind: 'DAY1', status: 'RELEASED', projectId: 'project-1', previousReportId: null };
    const draftReport = { id: 'report-2', kind: 'MONTHLY', status: 'DRAFT', projectId: 'project-1', previousReportId: null };
    const inReviewReport = { id: 'report-3', kind: 'MONTHLY', status: 'IN_REVIEW', projectId: 'project-1', previousReportId: null };

    it('review 409s on a DAY1 report', async () => {
      prisma.report.findFirst.mockResolvedValue(day1Report);
      await expect(service.review('client-1', 'report-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('review 409s when the report is not DRAFT', async () => {
      prisma.report.findFirst.mockResolvedValue(inReviewReport);
      await expect(service.review('client-1', 'report-3')).rejects.toBeInstanceOf(ConflictException);
    });

    it('review re-collects fresh content and moves DRAFT to IN_REVIEW', async () => {
      prisma.report.findFirst
        .mockResolvedValueOnce(draftReport) // getOwned
        .mockResolvedValueOnce(draftReport); // getOne -> getOwned again
      prisma.project.findUniqueOrThrow.mockResolvedValue(project);
      prisma.reportRevision.findFirst.mockResolvedValueOnce({ revisionNumber: 1 }).mockResolvedValueOnce({ contentSnapshot: {} });

      await service.review('client-1', 'report-2');

      expect(prisma.reportRevision.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ revisionNumber: 2 }) }));
      expect(prisma.report.update).toHaveBeenCalledWith({ where: { id: 'report-2' }, data: { status: 'IN_REVIEW', executiveSummary: 'All good.' } });
    });

    it('approve 409s on a DAY1 report', async () => {
      prisma.report.findFirst.mockResolvedValue(day1Report);
      await expect(service.approve('client-1', 'report-1', { approved: true })).rejects.toBeInstanceOf(ConflictException);
    });

    it('approve 409s when the report is not IN_REVIEW', async () => {
      prisma.report.findFirst.mockResolvedValue(draftReport);
      await expect(service.approve('client-1', 'report-2', { approved: true })).rejects.toBeInstanceOf(ConflictException);
    });

    it('approve({approved:false}) sends the report back to DRAFT without touching revisions', async () => {
      prisma.report.findFirst.mockResolvedValueOnce(inReviewReport).mockResolvedValueOnce({ ...inReviewReport, status: 'DRAFT' });
      prisma.reportRevision.findFirst.mockResolvedValue({ contentSnapshot: {} });

      await service.approve('client-1', 'report-3', { approved: false, changesRequested: 'fix the numbers' });

      expect(prisma.report.update).toHaveBeenCalledWith({ where: { id: 'report-3' }, data: { status: 'DRAFT' } });
      expect(prisma.reportRevision.create).not.toHaveBeenCalled();
    });

    it('approve({approved:true}) releases the newest revision', async () => {
      prisma.report.findFirst.mockResolvedValueOnce(inReviewReport).mockResolvedValueOnce({ ...inReviewReport, status: 'RELEASED', releasedRevisionId: 'rev-9' });
      prisma.reportRevision.findFirst.mockResolvedValueOnce({ id: 'rev-9', revisionNumber: 2 });
      prisma.reportRevision.findUnique.mockResolvedValue({ contentSnapshot: {} });

      await service.approve('client-1', 'report-3', { approved: true });

      expect(prisma.report.update).toHaveBeenCalledWith({
        where: { id: 'report-3' },
        data: { status: 'RELEASED', releasedRevisionId: 'rev-9', releasedAt: expect.any(Date) },
      });
    });

    it('withdraw 409s unless the report is RELEASED', async () => {
      prisma.report.findFirst.mockResolvedValue(draftReport);
      await expect(service.withdraw('client-1', 'report-2')).rejects.toBeInstanceOf(ConflictException);
    });

    it('withdraw sets WITHDRAWN on a released report', async () => {
      const released = { ...day1Report };
      prisma.report.findFirst.mockResolvedValueOnce(released).mockResolvedValueOnce({ ...released, status: 'WITHDRAWN' });
      prisma.reportRevision.findUnique.mockResolvedValue({ contentSnapshot: {} });

      await service.withdraw('client-1', 'report-1');

      expect(prisma.report.update).toHaveBeenCalledWith({ where: { id: 'report-1' }, data: { status: 'WITHDRAWN' } });
    });
  });

  describe('getPublic', () => {
    it('404s when the link does not exist or is revoked', async () => {
      prisma.reportShareLink.findUnique.mockResolvedValue(null);
      await expect(service.getPublic('bad-token')).rejects.toBeInstanceOf(NotFoundException);

      prisma.reportShareLink.findUnique.mockResolvedValue({ revokedAt: new Date() });
      await expect(service.getPublic('revoked-token')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s when the report was never released', async () => {
      prisma.reportShareLink.findUnique.mockResolvedValue({ revokedAt: null, report: { status: 'DRAFT', releasedRevision: null } });
      await expect(service.getPublic('token')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('renders the released revision when the link is live', async () => {
      prisma.reportShareLink.findUnique.mockResolvedValue({ revokedAt: null, report: { status: 'RELEASED', releasedRevision: { contentSnapshot: { foo: 'bar' } } } });
      const result = await service.getPublic('token');
      expect(result).toEqual({ html: '<html></html>' });
      expect(renderer.render).toHaveBeenCalledWith({ foo: 'bar' });
    });
  });

  describe('getBySlug', () => {
    it('scopes the lookup to the caller client when they have one', async () => {
      prisma.report.findFirst.mockResolvedValue(null);
      await expect(service.getBySlug('client-1', 'acme-day1-abcd1234')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.report.findFirst).toHaveBeenCalledWith({ where: { slug: 'acme-day1-abcd1234', project: { deletedAt: null, clientId: 'client-1' } } });
    });

    it('is unscoped for a null caller client (ADMIN)', async () => {
      prisma.report.findFirst.mockResolvedValue(null);
      await expect(service.getBySlug(null, 'acme-day1-abcd1234')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.report.findFirst).toHaveBeenCalledWith({ where: { slug: 'acme-day1-abcd1234', project: { deletedAt: null } } });
    });

    it('returns the released snapshot for a released report', async () => {
      prisma.report.findFirst.mockResolvedValue({ id: 'report-1', status: 'RELEASED', releasedRevisionId: 'rev-1' });
      prisma.reportRevision.findUnique.mockResolvedValue({ contentSnapshot: { foo: 'bar' } });

      const result = await service.getBySlug('client-1', 'slug');

      expect(result.content).toEqual({ foo: 'bar' });
    });
  });
});
