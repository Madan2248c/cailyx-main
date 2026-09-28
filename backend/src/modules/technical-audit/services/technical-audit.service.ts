/**
 * Technical Audit orchestrator — creates runs, drives the eight checks, and
 * owns the run's lifecycle fields.
 *
 * Eight checks run **strictly sequentially** (not `Promise.all`) — cheap
 * access checks before the expensive crawl — ported in this order:
 *
 * ```
 * robots → cdn-inferred → sitemap → js-render → cwv → schema
 *        → agent-readiness → page-inventory
 * ```
 *
 * `page-inventory` only runs if `sitemap.entries.length > 0`; with no sitemap
 * it's skipped with a `not-run` finding, not routed through error handling.
 * Every other check is wrapped so a thrown error becomes an `error`-status
 * finding, never aborts the run. See docs/analysis/technical-audit.md
 * "Pipeline".
 *
 * Division of responsibility:
 *
 * - **This service** owns `technical_audit_runs.status/score/result/findings/
 *   deltas/narrative`, the `audit_pages` rows, and the previous-run diff chain.
 * - **A check** owns its own analysis and returns an `AuditFinding` (sitemap
 *   and page-inventory additionally return their entries/pages for the next
 *   step). A check never touches Prisma itself — except `PageInventoryCheck`,
 *   which takes a `PrismaService` argument solely for the optional
 *   `discoveredPage` title/meta reuse read.
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { AuditEvents } from '../../../common/events/audit-events.js';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { TechnicalAuditStatus } from '../../../generated/prisma/enums.js';
import { FetcherService } from '../../fetcher/fetcher.service.js';
import { COMPOSITE_WEIGHTS, DEFAULT_MAX_COST_PER_RUN_USD } from '../technical-audit.constants.js';
import type {
  AgentReadinessAnalysis,
  AuditCheckType,
  AuditComparison,
  AuditDelta,
  AuditFinding,
  AuditPageResult,
  CwvAnalysis,
  JsRenderAnalysis,
  PageInventoryAnalysis,
  PageMetadata,
  TechnicalAuditResult,
} from '../technical-audit.types.js';
import {
  TECHNICAL_AUDIT_JOB,
  TECHNICAL_AUDIT_JOB_OPTIONS,
  TECHNICAL_AUDIT_QUEUE,
  type TechnicalAuditJobData,
} from '../queue/technical-audit.queue.js';
import type { AuditContext, AuditProjectRef } from './audit-context.js';
import { AgentReadinessCheck } from './checks/agent-readiness.check.js';
import { CdnCheck } from './checks/cdn.check.js';
import { CwvCheck } from './checks/cwv.check.js';
import { JsRenderCheck } from './checks/js-render.check.js';
import { PageInventoryCheck } from './checks/page-inventory.check.js';
import { RobotsCheck } from './checks/robots.check.js';
import { SchemaCheck } from './checks/schema.check.js';
import { SitemapCheck } from './checks/sitemap.check.js';
import { NarrativeService } from './narrative.service.js';
import { PageMetadataService } from './page-metadata.service.js';
import { buildComparison, computeDeltas, type ComparableRun } from './technical-audit.deltas.js';

const TERMINAL_STATUSES = new Set<TechnicalAuditStatus>(['COMPLETE', 'FAILED']);

/* eslint-disable @typescript-eslint/no-explicit-any */
function asJson(value: unknown): any {
  return JSON.parse(JSON.stringify(value ?? null)) as any;
}

@Injectable()
export class TechnicalAuditService {
  private readonly logger = new Logger(TechnicalAuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly fetcher: FetcherService,
    @InjectQueue(TECHNICAL_AUDIT_QUEUE) private readonly queue: Queue<TechnicalAuditJobData>,
    private readonly robotsCheck: RobotsCheck,
    private readonly cdnCheck: CdnCheck,
    private readonly sitemapCheck: SitemapCheck,
    private readonly jsRenderCheck: JsRenderCheck,
    private readonly cwvCheck: CwvCheck,
    private readonly schemaCheck: SchemaCheck,
    private readonly agentReadinessCheck: AgentReadinessCheck,
    private readonly pageInventoryCheck: PageInventoryCheck,
    private readonly pageMetadata: PageMetadataService,
    private readonly narrative: NarrativeService,
    @Optional() private readonly auditEvents?: AuditEvents,
  ) {}

  // ─── Producing runs ─────────────────────────────────────────────────────

  /**
   * Creates a `technical_audit_runs` row for a project and queues it.
   *
   * Deliberately does **not** throw when another run is already active or the
   * queue is unreachable: the former returns the active run (a concurrent run
   * for one project would corrupt the previous-run diff chain), the latter
   * leaves the row `FAILED` with the reason, so a run that will never start
   * cannot masquerade as one that is about to.
   */
  async startRun(projectId: string, reason: TechnicalAuditJobData['reason'] = 'manual') {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, deletedAt: null } });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    const active = await this.prisma.technicalAuditRun.findFirst({
      where: { projectId, status: { in: ['QUEUED', 'RUNNING'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (active) {
      this.logger.debug(`Technical audit for project ${projectId} already ${active.status} (${active.id}). Not starting another.`);
      return active;
    }

    // Resolved BEFORE this row is created, so the chain is unambiguous even
    // with overlapping runs. A failed/partial prior run (no score) never
    // becomes the diff baseline.
    const previous = await this.prisma.technicalAuditRun.findFirst({
      where: { projectId, score: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    const run = await this.prisma.technicalAuditRun.create({
      data: {
        projectId,
        status: 'QUEUED',
        triggeredBy: reason === 'scheduled' ? 'SCHEDULED' : 'MANUAL',
        previousAuditId: previous?.id ?? null,
      },
    });

    await this.enqueue(run.id, projectId, reason);
    return run;
  }

  /**
   * Admin trigger: starts a new run for the project (or returns the active
   * one when a run is already queued/running).
   *
   * 404 rather than 403 when a project belongs to another client: whether
   * that project exists is itself not this caller's business.
   */
  async rerun(clientId: string, projectId: string) {
    await this.assertProjectInClient(projectId, clientId);
    return this.startRun(projectId, 'manual');
  }

  private async assertProjectInClient(projectId: string, clientId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, clientId, deletedAt: null },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }
  }

  private async enqueue(auditRunId: string, projectId: string, reason: TechnicalAuditJobData['reason']): Promise<void> {
    try {
      await this.queue.add(TECHNICAL_AUDIT_JOB, { auditRunId, projectId, reason }, TECHNICAL_AUDIT_JOB_OPTIONS);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Could not enqueue technical audit run ${auditRunId}: ${message}`);
      await this.prisma.technicalAuditRun.update({
        where: { id: auditRunId },
        data: { status: 'FAILED', completedAt: new Date() },
      });
    }
  }

  // ─── Consuming runs ─────────────────────────────────────────────────────

  /**
   * Runs one job: the eight checks sequentially, then metadata, score,
   * deltas, persistence, and the narrative — all inside this single job.
   * No multi-stage pause/resume here (see the analysis doc "Job
   * orchestration"): these are bounded HTTP/browser calls, not an
   * open-ended LLM loop.
   *
   * Re-entrant by design — a BullMQ retry lands here, sees a terminal row,
   * and does nothing rather than running the crawl twice.
   */
  async executeRun(auditRunId: string): Promise<void> {
    const run = await this.prisma.technicalAuditRun.findUnique({
      where: { id: auditRunId },
      include: { project: true },
    });
    if (!run) {
      throw new NotFoundException('Technical audit run not found: ' + auditRunId);
    }
    if (TERMINAL_STATUSES.has(run.status)) {
      this.logger.debug(`Technical audit run ${run.id} is already ${run.status}. Nothing to do.`);
      return;
    }
    if (run.project.deletedAt) {
      await this.prisma.technicalAuditRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', completedAt: new Date() },
      });
      return;
    }

    const targetUrl = this.targetUrlFor(run.project.domain);
    const projectRef: AuditProjectRef = { id: run.project.id, name: run.project.name, domain: run.project.domain };
    const ctx: AuditContext = { runId: run.id, project: projectRef, targetUrl };

    await this.prisma.technicalAuditRun.update({
      where: { id: run.id },
      data: { status: 'RUNNING', startedAt: run.startedAt ?? new Date() },
    });

    try {
      const findings: AuditFinding[] = [];
      const isolated = async (label: AuditCheckType, fn: () => Promise<AuditFinding>) => {
        try {
          findings.push(await fn());
        } catch (err) {
          findings.push(this.errorFinding(label, err instanceof Error ? err.message : String(err)));
        }
      };

      await isolated('robots', () => this.robotsCheck.run(ctx));
      await isolated('cdn-inferred', () => this.cdnCheck.run(ctx));

      // The sitemap runs before page-inventory because it *is* the
      // inventory's input — its entries decide what gets crawled.
      let sitemapEntries: Array<{ url: string; lastmod: string | null }> = [];
      await isolated('sitemap', async () => {
        const res = await this.sitemapCheck.run(ctx);
        sitemapEntries = res.entries;
        const { entries: _dropped, ...finding } = res;
        return finding;
      });

      await isolated('js-render', () => this.jsRenderCheck.run(ctx));
      await isolated('cwv', () => this.cwvCheck.run(ctx));
      await isolated('schema', () => this.schemaCheck.run(ctx));
      await isolated('agent-readiness', () => this.agentReadinessCheck.run(ctx));

      // Site-wide crawl. Skipped rather than failed when there is no sitemap
      // — "we could not enumerate the site" is not the same claim as "the
      // pages are bad", and failing here would double-count the sitemap
      // finding that has already fired.
      let pages: AuditPageResult[] = [];
      if (sitemapEntries.length > 0) {
        await isolated('page-inventory', async () => {
          const res = await this.pageInventoryCheck.run(ctx, sitemapEntries, this.prisma);
          pages = res.pages;
          const { pages: _dropped, ...finding } = res;
          return finding;
        });
      } else {
        findings.push({
          type: 'page-inventory',
          status: 'not-run',
          detail: { reason: 'No sitemap URLs to crawl', discovered: 0, crawled: 0 },
          severity: 'low',
          confidence: 'confirmed',
          recommendedFix:
            'Publish a sitemap.xml listing your indexable pages and declare it in robots.txt. ' +
            'Without one, the per-page structured-data and metadata audit cannot enumerate the site.',
        });
      }

      // Page metadata capture — a best-effort extra pass, non-fatal on failure.
      let pageMetadata: PageMetadata | null = null;
      try {
        pageMetadata = await this.pageMetadata.capture(ctx);
      } catch (err) {
        this.logger.warn(`Failed to capture page metadata for run ${run.id}: ${(err as Error).message}`);
      }

      const readiness = this.readinessFrom(findings);
      const inventory = this.inventoryFrom(findings);
      const score = this.computeComposite(findings, inventory, readiness);

      const current: ComparableRun = {
        id: run.id,
        createdAt: new Date().toISOString(),
        score,
        findings: findings.map((f) => ({ type: f.type, status: f.status, severity: f.severity, detail: f.detail })),
        pages: pages.map((p) => ({ url: p.url, score: p.score, issues: [...p.issues] })),
      };
      const { previousAt, previousNarrative, deltas } = await this.diffAgainstPrevious(run.projectId, run.previousAuditId, current);

      const observability = this.observe(run.id, findings.length);
      const result: TechnicalAuditResult = {
        targetUrl,
        robots: this.analysisOf(findings, 'robots'),
        cdn: this.analysisOf(findings, 'cdn-inferred'),
        jsRender: this.analysisOf(findings, 'js-render'),
        cwv: this.analysisOf(findings, 'cwv'),
        schema: this.analysisOf(findings, 'schema'),
        sitemap: this.analysisOf(findings, 'sitemap'),
        agentReadiness: this.analysisOf(findings, 'agent-readiness'),
        pageInventory: this.analysisOf(findings, 'page-inventory'),
        pageMetadata,
        observability,
      };

      await this.persist(run.id, run.projectId, { score, result, findings, deltas, pages });

      // Narrative last, and deliberately after the write. It is the only
      // step that leaves the machine for a model, so it must not be able to
      // cost us the run: the audit is already durable by this point, and a
      // failure here leaves `narrative` null with every number intact.
      try {
        const written = await this.narrative.write({
          run: { at: new Date().toISOString(), score },
          previousRun: previousAt ? { at: previousAt, score: await this.previousScore(run.previousAuditId) } : null,
          deltas,
          findings: findings.map((f) => ({ type: f.type, status: f.status, severity: f.severity, recommendedFix: f.recommendedFix })),
          previousNarrative,
        });
        if (written) {
          await this.prisma.technicalAuditRun.update({
            where: { id: run.id },
            data: { narrative: written.text, narrativeModel: written.model },
          });
          if (written.costUsd > 0 && observability) {
            observability.totalCostUsd = Math.round((observability.totalCostUsd + written.costUsd) * 10_000) / 10_000;
            await this.prisma.technicalAuditRun.update({ where: { id: run.id }, data: { result: asJson(result) } });
          }
        }
      } catch (err) {
        this.logger.warn(`Narrative step failed for run ${run.id}: ${(err as Error).message}`);
      }

      const failCount = findings.filter((f) => f.status === 'fail').length;
      this.logger.log(
        `Technical audit complete for ${targetUrl}: score ${score ?? 'n/a'}, ` +
          `${failCount} failures across ${findings.length} checks, ${pages.length} pages crawled`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Technical audit run ${run.id} failed: ${message}`);
      // Record the failure but rethrow, so BullMQ's own attempts/backoff
      // decide whether to try again. The retry resumes idempotently: a
      // terminal row is a no-op (see above), anything else re-runs fully.
      await this.prisma.technicalAuditRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', completedAt: new Date() },
      });
      throw err;
    }
  }

  private targetUrlFor(domain: string): string {
    const raw = domain.trim();
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      return new URL(withScheme).toString();
    } catch {
      return `https://${raw}`;
    }
  }

  private errorFinding(type: AuditCheckType, errorMsg: string): AuditFinding {
    return {
      type,
      status: 'error',
      detail: { error: errorMsg },
      severity: 'low',
      confidence: 'confirmed',
      recommendedFix: `Check failed with error: ${errorMsg}. Retry the audit or check logs.`,
    };
  }

  // ─── Composite score ──────────────────────────────────────────────────

  /**
   * Roll the checks into one 0-100 number. Weights sum to 100 (see
   * `COMPOSITE_WEIGHTS`); missing components are dropped and the remainder
   * renormalized — a deliberate, documented exception, not an oversight (see
   * the analysis doc "Composite score"): a component can be genuinely absent
   * (no PSI key, no sitemap), and scoring an unrun check as zero would report
   * a configuration gap as a site defect. Returns `null` if nothing
   * scoreable ran at all.
   */
  computeComposite(
    findings: AuditFinding[],
    inventory: PageInventoryAnalysis | null,
    readinessScore: number | null,
  ): number | null {
    const parts: Array<{ weight: number; value: number }> = [];
    const by = (t: string) => findings.find((f) => f.type === t);

    // access — robots + CDN, scored on what fraction of probed bots got through
    const cdn = by('cdn-inferred');
    const robots = by('robots');
    if (cdn || robots) {
      const d = cdn?.detail as { probes?: unknown[]; blockedBots?: unknown[] } | undefined;
      const probed = Array.isArray(d?.probes) ? d.probes.length : 0;
      const blocked = Array.isArray(d?.blockedBots) ? d.blockedBots.length : 0;
      const cdnScore = probed > 0 ? Math.round(((probed - blocked) / probed) * 100) : cdn?.status === 'pass' ? 100 : 50;
      const robotsScore = robots ? (robots.status === 'pass' ? 100 : 40) : cdnScore;
      parts.push({ weight: COMPOSITE_WEIGHTS.access, value: Math.round((cdnScore + robotsScore) / 2) });
    }

    // rendering — the JS-dependency check, expressed as content retained
    const js = by('js-render');
    if (js && js.status !== 'error' && js.status !== 'not-run') {
      const loss = (js.detail as unknown as JsRenderAnalysis | undefined)?.contentLossPercent;
      parts.push({
        weight: COMPOSITE_WEIGHTS.rendering,
        value: typeof loss === 'number' ? Math.max(0, Math.round(100 - loss)) : js.status === 'pass' ? 100 : 50,
      });
    }

    // structured data — homepage schema, plus site-wide JSON-LD coverage
    const schema = by('schema');
    const structuredParts: number[] = [];
    if (schema && schema.status !== 'error') structuredParts.push(schema.status === 'pass' ? 100 : 40);
    if (inventory && inventory.crawled > 0) {
      structuredParts.push(Math.round(((inventory.crawled - inventory.pagesWithoutJsonLd) / inventory.crawled) * 100));
    }
    if (structuredParts.length) {
      parts.push({
        weight: COMPOSITE_WEIGHTS.structured,
        value: Math.round(structuredParts.reduce((a, b) => a + b, 0) / structuredParts.length),
      });
    }

    // content — the per-page rubric average
    if (inventory?.averageScore !== null && inventory?.averageScore !== undefined) {
      parts.push({ weight: COMPOSITE_WEIGHTS.content, value: inventory.averageScore });
    }

    // performance — Lighthouse performance category
    const cwv = by('cwv');
    const perf = (cwv?.detail as CwvAnalysis | undefined)?.performanceScore;
    if (typeof perf === 'number') parts.push({ weight: COMPOSITE_WEIGHTS.performance, value: perf });

    // agent readiness — is-agentic
    if (readinessScore !== null && readinessScore !== undefined) {
      parts.push({ weight: COMPOSITE_WEIGHTS.agent, value: readinessScore });
    }

    if (!parts.length) return null;
    const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
    const weighted = parts.reduce((s, p) => s + p.value * p.weight, 0);
    return Math.max(0, Math.min(100, Math.round(weighted / totalWeight)));
  }

  private readinessFrom(findings: AuditFinding[]): number | null {
    const detail = findings.find((f) => f.type === 'agent-readiness')?.detail as AgentReadinessAnalysis | undefined;
    return typeof detail?.score === 'number' ? detail.score : null;
  }

  private inventoryFrom(findings: AuditFinding[]): PageInventoryAnalysis | null {
    const detail = findings.find((f) => f.type === 'page-inventory')?.detail as PageInventoryAnalysis | undefined;
    return typeof detail?.crawled === 'number' ? detail : null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private analysisOf(findings: AuditFinding[], type: string): any {
    const detail = findings.find((f) => f.type === type)?.detail;
    return detail === undefined ? null : detail;
  }

  // ─── Deltas ───────────────────────────────────────────────────────────

  private async diffAgainstPrevious(
    projectId: string,
    previousAuditId: string | null,
    current: ComparableRun,
  ): Promise<{ previousAt: string | null; previousNarrative: string | null; deltas: AuditDelta[] }> {
    const none = { previousAt: null as string | null, previousNarrative: null as string | null };
    try {
      if (!previousAuditId) {
        // First scored audit for this project — every metric is "new".
        const prev = await this.prisma.technicalAuditRun.findFirst({
          where: { projectId, score: { not: null } },
          orderBy: { createdAt: 'desc' },
        });
        if (!prev) return { ...none, deltas: computeDeltas(current, null) };
        // A previous scored run exists but this run was chained to nothing
        // (e.g. created before chaining) — diff against it anyway.
        return this.diffAgainstRow(prev.id, current);
      }
      return this.diffAgainstRow(previousAuditId, current);
    } catch (err) {
      this.logger.warn(`Could not diff against previous audit: ${(err as Error).message}`);
      return { ...none, deltas: [] as AuditDelta[] };
    }
  }

  private async diffAgainstRow(
    previousAuditId: string,
    current: ComparableRun,
  ): Promise<{ previousAt: string | null; previousNarrative: string | null; deltas: AuditDelta[] }> {
    const prev = await this.prisma.technicalAuditRun.findUnique({
      where: { id: previousAuditId },
      include: { pages: true },
    });
    if (!prev) return { previousAt: null, previousNarrative: null, deltas: computeDeltas(current, null) };
    return {
      previousAt: prev.createdAt.toISOString(),
      previousNarrative: prev.narrative ?? null,
      deltas: computeDeltas(current, this.toComparable(prev)),
    };
  }

  private async previousScore(previousAuditId: string | null): Promise<number | null> {
    if (!previousAuditId) return null;
    const prev = await this.prisma.technicalAuditRun.findUnique({ where: { id: previousAuditId }, select: { score: true } });
    return prev?.score ?? null;
  }

  /**
   * Rehydrate a stored run into the differ's shape. `findings`/`issues` come
   * back as JSON columns; anything that fails to parse degrades to an empty
   * value rather than throwing, since a single malformed row must not break
   * the whole comparison.
   */
  private toComparable(row: {
    id: string;
    createdAt: Date;
    score: number | null;
    findings: unknown;
    pages: Array<{ url: string; score: number; issues: unknown }>;
  }): ComparableRun {
    const findings = Array.isArray(row.findings)
      ? (row.findings as Array<{ type: string; status: string; severity: string; detail: unknown }>)
      : [];
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      score: row.score,
      findings,
      pages: row.pages.map((pg) => ({
        url: pg.url,
        score: pg.score ?? 0,
        issues: Array.isArray(pg.issues) ? (pg.issues as string[]) : [],
      })),
    };
  }

  // ─── Observability + persistence ──────────────────────────────────────

  private observe(runId: string, checksRun: number) {
    const fetcherLogs = this.fetcher.getLogsByRun(runId);
    const totalCost = this.fetcher.getRunCost(runId);
    const cacheHits = fetcherLogs.filter((l) => l.cached).length;
    const totalLatency = fetcherLogs.reduce((sum, l) => sum + l.latencyMs, 0);
    const observability = {
      totalCostUsd: totalCost,
      fetcherLogCount: fetcherLogs.length,
      totalLatencyMs: totalLatency,
      probesRun: fetcherLogs.filter((l) => l.method === 'probe').length,
      checksRun,
      cacheHitRate: fetcherLogs.length > 0 ? cacheHits / fetcherLogs.length : 0,
    };
    const ceiling = Number(this.config.get<string | number>('TECHNICAL_AUDIT_MAX_COST_PER_RUN_USD')) || DEFAULT_MAX_COST_PER_RUN_USD;
    if (totalCost > ceiling) {
      this.logger.warn(`Audit ${runId} cost $${totalCost.toFixed(4)}, over the $${ceiling} per-run ceiling`);
    }
    return observability;
  }

  private async persist(
    runId: string,
    projectId: string,
    compiled: { score: number | null; result: TechnicalAuditResult; findings: AuditFinding[]; deltas: AuditDelta[]; pages: AuditPageResult[] },
  ): Promise<void> {
    await this.prisma.technicalAuditRun.update({
      where: { id: runId },
      data: {
        status: 'COMPLETE',
        score: compiled.score,
        result: asJson(compiled.result),
        findings: asJson(compiled.findings),
        deltas: asJson(compiled.deltas),
        completedAt: new Date(),
      },
    });

    // Pages are written in chunks. A 150-page single createMany builds one
    // enormous statement; chunking keeps every statement bounded.
    if (compiled.pages.length) {
      const CHUNK = 25;
      for (let i = 0; i < compiled.pages.length; i += CHUNK) {
        await this.prisma.auditPage.createMany({
          data: compiled.pages.slice(i, i + CHUNK).map((pg) => ({
            technicalAuditRunId: runId,
            projectId,
            url: pg.url,
            statusCode: pg.status,
            score: pg.score,
            issues: asJson(pg.issues),
            signals: asJson({
              title: pg.title,
              titleLength: pg.titleLength,
              metaDescription: pg.metaDescription,
              metaDescLength: pg.metaDescLength,
              h1Count: pg.h1Count,
              canonical: pg.canonical,
              wordCount: pg.wordCount,
              imageCount: pg.imageCount,
              imagesMissingAlt: pg.imagesMissingAlt,
              jsonLdTypes: pg.jsonLdTypes,
              jsonLdValid: pg.jsonLdValid,
              jsonLdCount: pg.jsonLdCount,
              lastmod: pg.lastmod,
              status: pg.status,
            }),
          })),
        });
      }
    }
    this.logger.debug(`Audit persisted to DB: ${runId} (${compiled.pages.length} pages)`);
    this.auditEvents?.completed({ module: 'technical-audit', projectId, runId });
  }

  // ─── Reading runs (staff-facing) ──────────────────────────────────────

  /** One run with its worst pages first — what an operator reads top-down. */
  async getRun(clientId: string, auditRunId: string) {
    const run = await this.prisma.technicalAuditRun.findUnique({
      where: { id: auditRunId },
      include: { project: { select: { clientId: true } } },
    });
    if (!run || run.project.clientId !== clientId) {
      throw new NotFoundException('Technical audit run not found.');
    }
    const pages = await this.prisma.auditPage.findMany({
      where: { technicalAuditRunId: auditRunId },
      orderBy: { score: 'asc' },
      take: 100,
    });
    return { ...this.publicRun(run), pages };
  }

  /** A project's run history, newest first. */
  async listRuns(clientId: string, projectId: string, take = 20) {
    await this.assertProjectInClient(projectId, clientId);
    const runs = await this.prisma.technicalAuditRun.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return runs.map((run) => this.publicRun(run));
  }

  /** Previous-vs-current comparison for one run, for the trend view. */
  async getComparison(clientId: string, auditId: string): Promise<AuditComparison | null> {
    const current = await this.prisma.technicalAuditRun.findUnique({
      where: { id: auditId },
      include: { pages: true, project: { select: { clientId: true } } },
    });
    if (!current || current.project.clientId !== clientId) return null;
    const previous = current.previousAuditId
      ? await this.prisma.technicalAuditRun.findUnique({ where: { id: current.previousAuditId }, include: { pages: true } })
      : null;
    return buildComparison(this.toComparable({ ...current, findings: current.findings }), previous ? this.toComparable({ ...previous, findings: previous.findings }) : null);
  }

  /** The project's score history, oldest first — the series a sparkline needs. */
  async getTrend(clientId: string, projectId: string, limit = 30) {
    await this.assertProjectInClient(projectId, clientId);
    const n = Math.min(Math.max(limit, 1), 200);
    const rows = await this.prisma.technicalAuditRun.findMany({
      where: { projectId, score: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: n,
      select: { id: true, createdAt: true, score: true, findings: true, triggeredBy: true },
    });
    return rows
      .map((r) => {
        const findings = Array.isArray(r.findings) ? (r.findings as Array<{ status: string }>) : [];
        return {
          auditId: r.id,
          at: r.createdAt.toISOString(),
          score: r.score,
          triggeredBy: r.triggeredBy,
          failures: findings.filter((f) => f.status === 'fail').length,
        };
      })
      .reverse();
  }

  private publicRun(run: {
    id: string;
    projectId: string;
    status: TechnicalAuditStatus;
    triggeredBy: string;
    previousAuditId: string | null;
    score: number | null;
    findings: unknown;
    deltas: unknown;
    narrative: string | null;
    narrativeModel: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
  }) {
    const findings = Array.isArray(run.findings) ? run.findings : [];
    return {
      id: run.id,
      projectId: run.projectId,
      status: run.status,
      triggeredBy: run.triggeredBy,
      previousAuditId: run.previousAuditId,
      score: run.score,
      findingSummary: (findings as Array<{ type: string; status: string; severity: string }>).map((f) => ({
        type: f.type,
        status: f.status,
        severity: f.severity,
      })),
      findings,
      deltas: run.deltas,
      narrative: run.narrative,
      narrativeModel: run.narrativeModel,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
    };
  }
}
