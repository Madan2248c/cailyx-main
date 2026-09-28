/**
 * Reporting orchestrator — collects the latest completed run from every
 * source module, assembles + renders one report, and gates client
 * visibility through the editorial lifecycle (except DAY1, which bypasses
 * it entirely). See docs/analysis/reporting.md and module README.
 *
 * @module reporting/services/reporting.service
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { randomBytes, randomUUID } from 'node:crypto';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { AeoAuditReportCollector } from '../collectors/aeo-audit.collector.js';
import { CompetitorsReportCollector } from '../collectors/competitors.collector.js';
import { GapAnalysisReportCollector } from '../collectors/gap-analysis.collector.js';
import { SocialActivityCollector } from '../collectors/social-activity.collector.js';
import { TechnicalAuditCollector } from '../collectors/technical-audit.collector.js';
import type { ReportContent, ReportKind } from '../reporting.types.js';
import { buildSectionOrder, computeDeltas, type CollectedSections } from './report-content.js';
import { ReportNarrativeService } from './report-narrative.service.js';
import { ReportRenderService } from './report-render.service.js';

function asJson(value: unknown): any {
  return JSON.parse(JSON.stringify(value ?? null)) as any;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Injectable()
export class ReportingService {
  private readonly logger = new Logger(ReportingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly technicalAudit: TechnicalAuditCollector,
    private readonly socialActivity: SocialActivityCollector,
    private readonly aeoAudit: AeoAuditReportCollector,
    private readonly competitors: CompetitorsReportCollector,
    private readonly gapAnalysis: GapAnalysisReportCollector,
    private readonly narrative: ReportNarrativeService,
    private readonly renderer: ReportRenderService,
  ) {}

  // ─── Generation ─────────────────────────────────────────────────────

  /**
   * Collects whatever sources are available, assembles content, renders,
   * and gates: DAY1 goes straight to RELEASED, MONTHLY starts as DRAFT.
   * A missing source is omitted, never fabricated — a project can still
   * generate a report with zero completed audits (an all-empty report is
   * a legitimate, if thin, outcome — never a 409).
   */
  async generate(clientId: string, projectId: string, kind: ReportKind) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null } });
    if (!project) throw new NotFoundException('Project not found.');

    const [technicalAuditSection, socialActivitySection, aeoAuditSection, competitorsSection, gapAnalysisSection] = await Promise.all([
      this.technicalAudit.collect(clientId, projectId),
      this.socialActivity.collect(clientId, projectId),
      this.aeoAudit.collect(clientId, projectId),
      this.competitors.collect(clientId, projectId),
      this.gapAnalysis.collect(clientId, projectId),
    ]);
    const sections: CollectedSections = {
      technicalAudit: technicalAuditSection,
      socialActivity: socialActivitySection,
      aeoAudit: aeoAuditSection,
      competitors: competitorsSection,
      gapAnalysis: gapAnalysisSection,
    };

    let previousReportId: string | null = null;
    let deltas: ReturnType<typeof computeDeltas> | null = null;
    if (kind === 'MONTHLY') {
      const previous = await this.prisma.report.findFirst({
        where: { projectId, status: 'RELEASED' },
        orderBy: { releasedAt: 'desc' },
        include: { releasedRevision: true },
      });
      if (previous?.releasedRevision) {
        previousReportId = previous.id;
        const previousContent = previous.releasedRevision.contentSnapshot as unknown as ReportContent;
        deltas = computeDeltas(previousContent, sections);
      }
    }

    const { summary, model } = await this.narrative.write(sections, deltas).then(
      (r) => r,
      (err) => {
        this.logger.warn(`Executive summary generation failed: ${(err as Error).message}`);
        return { summary: 'Executive summary unavailable for this report.', model: 'none' };
      },
    );

    const sectionOrder = buildSectionOrder(kind, sections, !!deltas && deltas.length > 0);
    const content: ReportContent = {
      meta: { projectName: project.name, domain: project.domain, kind, generatedAt: new Date().toISOString() },
      executiveSummary: summary,
      sectionOrder,
      technicalAudit: sections.technicalAudit,
      socialActivity: sections.socialActivity,
      aeoAudit: sections.aeoAudit,
      competitors: sections.competitors,
      gapAnalysis: sections.gapAnalysis,
      deltas,
    };
    void model; // recorded via logs only in this pass — no narrativeModel column on `reports`, matching the doc's minimal 3-table schema

    const slug = `${slugify(project.name)}-${kind.toLowerCase()}-${randomUUID().slice(0, 8)}`;
    const isDay1 = kind === 'DAY1';

    return this.prisma.$transaction(async (tx) => {
      const report = await tx.report.create({
        data: {
          projectId,
          kind,
          slug,
          status: isDay1 ? 'RELEASED' : 'DRAFT',
          title: `${project.name}: ${kind === 'DAY1' ? 'Day 1' : 'Monthly'} Report`,
          executiveSummary: summary,
          previousReportId,
          sourceTechnicalAuditRunId: sections.technicalAudit?.runId ?? null,
          sourceSocialActivityRunId: sections.socialActivity?.runId ?? null,
          sourceAeoAuditId: sections.aeoAudit?.auditId ?? null,
          sourceGapAnalysisRunId: sections.gapAnalysis?.runId ?? null,
          releasedAt: isDay1 ? new Date() : null,
        },
      });

      const revision = await tx.reportRevision.create({
        data: { reportId: report.id, revisionNumber: 1, contentSnapshot: asJson(content) },
      });

      if (isDay1) {
        await tx.report.update({ where: { id: report.id }, data: { releasedRevisionId: revision.id } });
      }

      return this.toDetail(await tx.report.findUniqueOrThrow({ where: { id: report.id } }), content);
    });
  }

  // ─── Reads ──────────────────────────────────────────────────────────

  async list(clientId: string, projectId: string, kind?: ReportKind) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null } });
    if (!project) throw new NotFoundException('Project not found.');
    return this.prisma.report.findMany({ where: { projectId, ...(kind ? { kind } : {}) }, orderBy: { createdAt: 'desc' } });
  }

  /** Live content if DRAFT/IN_REVIEW (always the latest revision), frozen snapshot if RELEASED/WITHDRAWN. */
  async getOne(clientId: string, reportId: string) {
    const { report, content } = await this.ownedWithContent(clientId, reportId);
    return this.toDetail(report, content);
  }

  /** The one read both `getOne` and `printDocument` go through, so the page and the PDF can't disagree. */
  private async ownedWithContent(clientId: string, reportId: string) {
    const report = await this.getOwned(clientId, reportId);
    const revision = report.status === 'RELEASED' || report.status === 'WITHDRAWN'
      ? await this.prisma.reportRevision.findUnique({ where: { id: report.releasedRevisionId ?? '' } })
      : await this.prisma.reportRevision.findFirst({ where: { reportId: report.id }, orderBy: { revisionNumber: 'desc' } });
    if (!revision) throw new NotFoundException('Report has no content yet.');
    return { report, content: revision.contentSnapshot as unknown as ReportContent };
  }

  async renderHtml(content: ReportContent): Promise<string> {
    return this.renderer.render(content);
  }

  /**
   * The print HTML behind "Download report", plus the file name to save it
   * under. Reads through {@link getOne}, so the PDF is exactly the content
   * (and the access rule) the report page itself shows: the frozen snapshot
   * once released, the latest revision before that.
   */
  async printDocument(clientId: string, reportId: string): Promise<{ html: string; fileName: string }> {
    const { report, content } = await this.ownedWithContent(clientId, reportId);
    const html = this.renderer.renderPrint(content, { createdAt: report.createdAt, releasedAt: report.releasedAt });
    const stamp = new Date(report.releasedAt ?? report.createdAt).toISOString().slice(0, 10);
    const base = `${content.meta.projectName}-${report.kind === 'DAY1' ? 'day1' : 'monthly'}-report-${stamp}`;
    const fileName = `${base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}.pdf`;
    return { html, fileName };
  }

  // ─── Editorial lifecycle (MONTHLY only) ────────────────────────────

  /** Snapshots the current content and locks it for review. 409 on a DAY1 report — nothing to review, it's already released. */
  async review(clientId: string, reportId: string) {
    const report = await this.getOwned(clientId, reportId);
    if (report.kind === 'DAY1') throw new ConflictException('DAY1 reports bypass the editorial gate. There is nothing to review.');
    if (report.status !== 'DRAFT') throw new ConflictException(`Report is ${report.status}. Only a draft can be sent for review.`);

    // Re-collect + re-render fresh content at review time — never trust a stale draft.
    const latest = await this.regenerateContent(clientId, report.projectId, report.kind as ReportKind, report.previousReportId);
    const nextRevisionNumber = ((await this.prisma.reportRevision.findFirst({ where: { reportId: report.id }, orderBy: { revisionNumber: 'desc' } }))?.revisionNumber ?? 0) + 1;

    await this.prisma.$transaction(async (tx) => {
      await tx.reportRevision.create({ data: { reportId: report.id, revisionNumber: nextRevisionNumber, contentSnapshot: asJson(latest) } });
      await tx.report.update({ where: { id: report.id }, data: { status: 'IN_REVIEW', executiveSummary: latest.executiveSummary } });
    });

    return this.getOne(clientId, reportId);
  }

  /**
   * `{approved:true}` releases the newest revision immediately.
   * `{approved:false}` returns the report to DRAFT — the revision stays as
   * history (never discarded), the next `review()` call creates the next
   * numbered one. `changesRequested` is accepted but not persisted in this
   * pass — the 3-table schema has no column for it; logged for now.
   */
  async approve(clientId: string, reportId: string, input: { approved: boolean; changesRequested?: string }) {
    const report = await this.getOwned(clientId, reportId);
    if (report.kind === 'DAY1') throw new ConflictException('DAY1 reports bypass the editorial gate. There is nothing to approve.');
    if (report.status !== 'IN_REVIEW') throw new ConflictException(`Report is ${report.status}. Only an in-review report can be approved or sent back.`);

    if (!input.approved) {
      this.logger.log(`Report ${report.id} sent back to draft. Changes requested: ${input.changesRequested ?? '(none given)'}`);
      await this.prisma.report.update({ where: { id: report.id }, data: { status: 'DRAFT' } });
      return this.getOne(clientId, reportId);
    }

    const revision = await this.prisma.reportRevision.findFirst({ where: { reportId: report.id }, orderBy: { revisionNumber: 'desc' } });
    if (!revision) throw new ConflictException('No revision to release.');

    await this.prisma.report.update({
      where: { id: report.id },
      data: { status: 'RELEASED', releasedRevisionId: revision.id, releasedAt: new Date() },
    });
    return this.getOne(clientId, reportId);
  }

  /** Pulls a released report from client visibility. Reasonable completion of the state machine — the analysis doc's status enum includes WITHDRAWN but names no explicit endpoint for it. */
  async withdraw(clientId: string, reportId: string) {
    const report = await this.getOwned(clientId, reportId);
    if (report.status !== 'RELEASED') throw new ConflictException(`Report is ${report.status}. Only a released report can be withdrawn.`);
    await this.prisma.report.update({ where: { id: report.id }, data: { status: 'WITHDRAWN' } });
    return this.getOne(clientId, reportId);
  }

  // ─── Share links ────────────────────────────────────────────────────

  async createShareLink(clientId: string, reportId: string) {
    const report = await this.getOwned(clientId, reportId);
    const token = randomBytes(24).toString('base64url');
    return this.prisma.reportShareLink.create({ data: { reportId: report.id, token } });
  }

  async revokeShareLink(clientId: string, reportId: string, linkId: string) {
    await this.getOwned(clientId, reportId);
    const link = await this.prisma.reportShareLink.findFirst({ where: { id: linkId, reportId } });
    if (!link) throw new NotFoundException('Share link not found.');
    return this.prisma.reportShareLink.update({ where: { id: linkId }, data: { revokedAt: new Date() } });
  }

  /** Token-only public render — no auth. Invisible if the report was never released or the link was revoked, regardless of `visibility`. */
  async getPublic(token: string) {
    const link = await this.prisma.reportShareLink.findUnique({ where: { token }, include: { report: { include: { releasedRevision: true } } } });
    if (!link || link.revokedAt) throw new NotFoundException('Link not found or revoked.');
    if (link.report.status !== 'RELEASED' || !link.report.releasedRevision) throw new NotFoundException('This report is not available.');
    const content = link.report.releasedRevision.contentSnapshot as unknown as ReportContent;
    return { html: await this.renderHtml(content) };
  }

  /**
   * Client-portal read by slug — no `:clientId` route param (the slug is
   * the whole address). `callerClientId` is the caller's own client from
   * their JWT: an ADMIN's is null (unscoped, can read any project's
   * report); a CLIENT_POC/MEMBER's is set, and the lookup is scoped to it
   * as defense-in-depth (slugs aren't guessable, but never trust that
   * alone). Fetches content directly — ownership is already established
   * by the query below, so this doesn't re-derive it through `getOwned`.
   */
  async getBySlug(callerClientId: string | null, slug: string) {
    const report = await this.prisma.report.findFirst({
      where: { slug, project: { deletedAt: null, ...(callerClientId ? { clientId: callerClientId } : {}) } },
    });
    if (!report) throw new NotFoundException('Report not found.');

    const revision =
      report.status === 'RELEASED' || report.status === 'WITHDRAWN'
        ? await this.prisma.reportRevision.findUnique({ where: { id: report.releasedRevisionId ?? '' } })
        : await this.prisma.reportRevision.findFirst({ where: { reportId: report.id }, orderBy: { revisionNumber: 'desc' } });
    if (!revision) throw new NotFoundException('Report has no content yet.');
    return this.toDetail(report, revision.contentSnapshot as unknown as ReportContent);
  }

  // ─── Internals ──────────────────────────────────────────────────────

  private async regenerateContent(clientId: string, projectId: string, kind: ReportKind, previousReportId: string | null): Promise<ReportContent> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const [technicalAuditSection, socialActivitySection, aeoAuditSection, competitorsSection, gapAnalysisSection] = await Promise.all([
      this.technicalAudit.collect(clientId, projectId),
      this.socialActivity.collect(clientId, projectId),
      this.aeoAudit.collect(clientId, projectId),
      this.competitors.collect(clientId, projectId),
      this.gapAnalysis.collect(clientId, projectId),
    ]);
    const sections: CollectedSections = {
      technicalAudit: technicalAuditSection,
      socialActivity: socialActivitySection,
      aeoAudit: aeoAuditSection,
      competitors: competitorsSection,
      gapAnalysis: gapAnalysisSection,
    };

    let deltas = null;
    if (previousReportId) {
      const previous = await this.prisma.report.findUnique({ where: { id: previousReportId }, include: { releasedRevision: true } });
      if (previous?.releasedRevision) deltas = computeDeltas(previous.releasedRevision.contentSnapshot as unknown as ReportContent, sections);
    }

    const { summary } = await this.narrative.write(sections, deltas).then(
      (r) => r,
      () => ({ summary: 'Executive summary unavailable for this report.', model: 'none' }),
    );

    return {
      meta: { projectName: project.name, domain: project.domain, kind, generatedAt: new Date().toISOString() },
      executiveSummary: summary,
      sectionOrder: buildSectionOrder(kind, sections, !!deltas && deltas.length > 0),
      technicalAudit: sections.technicalAudit,
      socialActivity: sections.socialActivity,
      aeoAudit: sections.aeoAudit,
      competitors: sections.competitors,
      gapAnalysis: sections.gapAnalysis,
      deltas,
    };
  }

  private async getOwned(clientId: string, reportId: string) {
    const report = await this.prisma.report.findFirst({ where: { id: reportId, project: { clientId, deletedAt: null } } });
    if (!report) throw new NotFoundException('Report not found.');
    return report;
  }

  private toDetail(report: { [k: string]: any }, content: ReportContent) {
    return { ...report, content };
  }
}
