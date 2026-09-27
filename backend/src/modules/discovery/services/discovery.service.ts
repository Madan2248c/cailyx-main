/**
 * Discovery orchestrator — creates runs, drives the stage loop, and owns the
 * run's lifecycle fields.
 *
 * The old repo drove this pipeline from HTTP calls, so its pause/resume was an
 * exception a caller had to catch and retry (`SiteContextRunPausedException` +
 * `resume()`). We have a job queue, so the two concerns collapse into one: the
 * elapsed-time budget pausing a run is just **this service enqueuing a
 * continuation job for the same run**. No caller has to know that happened —
 * see docs/analysis/discovery.md "Job orchestration".
 *
 * Division of responsibility, which the stage contract depends on:
 *
 * - **This service** owns `discovery_runs.status`, `.stage`, `.error`,
 *   `.notes`, the budget counters, and `pipeline_state`.
 * - **A stage** owns its own rows (pages, social profiles, the profile) and the
 *   contents of `ctx.state`. It never writes the fields above.
 */

import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { DiscoveryRunStatus } from '../../../generated/prisma/enums.js';
import {
  DEFAULT_MAX_CHARS,
  DEFAULT_MAX_ELAPSED_MS,
  DEFAULT_MAX_PAGES,
  DEFAULT_MAX_REQUESTS,
  DEFAULT_MAX_RETRIES_PER_PAGE,
  IDENTITY_CONFIDENCE_FLOOR,
  REACHABLE_PAGES_FLOOR,
  STAGE_ORDER,
} from '../discovery.constants.js';
import {
  readPageState,
  readRunState,
  type ArrayField,
  type CompanyContextProfileJson,
  type FactValue,
  type RunPipelineState,
  type ScalarField,
} from '../discovery.types.js';
import { DISCOVERY_CONTINUATION_JOB_OPTIONS, DISCOVERY_JOB, DISCOVERY_JOB_OPTIONS, DISCOVERY_QUEUE, type DiscoveryJobData } from '../queue/discovery.queue.js';
import { RunPausedException, RunBudget, type BudgetLimits, type DiscoveryProjectRef, type DiscoveryRunContext } from './pipeline-context.js';
import { asJson, normalizeDomain } from './pipeline-utils.js';
import { CompileStage } from './stages/compile.stage.js';
import { ConsolidateStage } from './stages/consolidate.stage.js';
import { DiscoverStage } from './stages/discover.stage.js';
import { ExternalEnrichStage } from './stages/external-enrich.stage.js';
import { ExtractStage } from './stages/extract.stage.js';
import { GapResearchStage } from './stages/gap-research.stage.js';
import { InspectStage } from './stages/inspect.stage.js';
import { ReconcileStage } from './stages/reconcile.stage.js';
import { SelectStage } from './stages/select.stage.js';
import { SocialDiscoveryStage } from './stages/social-discovery.stage.js';
import { ValidateStage } from './stages/validate.stage.js';
import { VerifyStage } from './stages/verify.stage.js';

type StageName = (typeof STAGE_ORDER)[number];

/** What the orchestrator needs from a stage — nothing more. */
interface PipelineStage {
  run(ctx: DiscoveryRunContext): Promise<void>;
}

/** Rare enough to be worth naming: the statuses that mean "this run is finished". */
const TERMINAL_STATUSES = new Set<DiscoveryRunStatus>(['COMPLETE', 'COMPLETE_WITH_GAPS', 'MANUAL_REVIEW_REQUIRED']);

/**
 * Client-editable profile paths (`section.field` → kind). Everything except
 * the evidence/meta sections (`sources`, `conflicts`, `missing_fields`,
 * `research_metadata`) — the client corrects claims, never provenance.
 */
const EDITABLE_PROFILE_FIELDS: Record<string, 'scalar' | 'array'> = {
  'identity.business_name': 'scalar',
  'identity.legal_name': 'scalar',
  'identity.alternate_names': 'array',
  'identity.brands': 'array',
  'identity.company_type': 'scalar',
  'identity.parent_company': 'scalar',
  'identity.subsidiaries': 'array',
  'identity.founded_year': 'scalar',
  'identity.primary_domain': 'scalar',
  'identity.related_domains': 'array',
  'identity.logo_url': 'scalar',
  'descriptions.one_line': 'scalar',
  'descriptions.short': 'scalar',
  'descriptions.detailed': 'scalar',
  'offerings.products': 'array',
  'offerings.services': 'array',
  'offerings.solutions': 'array',
  'offerings.packages': 'array',
  'offerings.delivery_model': 'scalar',
  'offerings.pricing_model': 'scalar',
  'offerings.pricing_details': 'array',
  'offerings.free_trial': 'scalar',
  'offerings.demo_available': 'scalar',
  'positioning.value_propositions': 'array',
  'positioning.differentiators': 'array',
  'positioning.problems_solved': 'array',
  'positioning.outcomes_promised': 'array',
  'positioning.key_messages': 'array',
  'positioning.claims_and_proof': 'array',
  'customers.icp_summary': 'scalar',
  'customers.company_sizes': 'array',
  'customers.industries': 'array',
  'customers.buyer_roles': 'array',
  'customers.user_roles': 'array',
  'customers.use_cases': 'array',
  'customers.named_customers': 'array',
  'customers.customer_examples': 'array',
  'geography.headquarters': 'scalar',
  'geography.offices': 'array',
  'geography.service_areas': 'array',
  'geography.countries': 'array',
  'geography.regions': 'array',
  'geography.languages': 'array',
  'geography.remote_or_local_delivery': 'scalar',
  'go_to_market.business_model': 'scalar',
  'go_to_market.sales_motion': 'scalar',
  'go_to_market.self_serve': 'scalar',
  'go_to_market.primary_ctas': 'array',
  'go_to_market.distribution_channels': 'array',
  'go_to_market.partners': 'array',
  'go_to_market.marketplaces': 'array',
  'credibility.case_studies': 'array',
  'credibility.testimonials': 'array',
  'credibility.awards': 'array',
  'credibility.certifications': 'array',
  'credibility.security_and_compliance': 'array',
  'credibility.review_profiles': 'array',
  'credibility.ratings': 'array',
  'organization.founders': 'array',
  'organization.leadership': 'array',
  'organization.team_members': 'array',
  'organization.team_size': 'scalar',
  'organization.hiring_areas': 'array',
  'organization.contact_details': 'array',
  'digital_presence.social_profiles': 'array',
  'digital_presence.app_profiles': 'array',
  'digital_presence.developer_profiles': 'array',
  'digital_presence.content_channels': 'array',
  'digital_presence.community_links': 'array',
  'technology.integrations': 'array',
  'technology.platforms_supported': 'array',
  'technology.api_available': 'scalar',
  'technology.technology_signals': 'array',
};

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);
  private readonly stages: Record<StageName, PipelineStage>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue(DISCOVERY_QUEUE) private readonly queue: Queue<DiscoveryJobData>,
    discover: DiscoverStage,
    inspect: InspectStage,
    select: SelectStage,
    extract: ExtractStage,
    reconcile: ReconcileStage,
    validate: ValidateStage,
    socialDiscovery: SocialDiscoveryStage,
    externalEnrich: ExternalEnrichStage,
    consolidate: ConsolidateStage,
    gapResearch: GapResearchStage,
    verify: VerifyStage,
    compile: CompileStage,
  ) {
    this.stages = {
      DISCOVER: discover,
      INSPECT: inspect,
      SELECT: select,
      EXTRACT: extract,
      RECONCILE: reconcile,
      VALIDATE: validate,
      SOCIAL_DISCOVERY: socialDiscovery,
      EXTERNAL_ENRICH: externalEnrich,
      CONSOLIDATE: consolidate,
      GAP_RESEARCH: gapResearch,
      VERIFY: verify,
      COMPILE: compile,
    };
  }

  // ─── Producing runs ─────────────────────────────────────────────────────

  /**
   * Creates a `discovery_runs` row for a project and queues it. Called by
   * `ProjectsService.createProject` in the same request — the admin's action is
   * "create a project", and discovery starting is a consequence of it, not a
   * separate decision to make.
   *
   * Deliberately does **not** throw when the queue is unreachable: a project
   * must still be creatable if Redis is down. The run row is left `FAILED` with
   * the reason, so a run that will never start cannot masquerade as one that is
   * about to.
   */
  async startRun(projectId: string, reason: DiscoveryJobData['reason'] = 'project-created') {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, deletedAt: null } });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    const previous = await this.prisma.companyContextProfile.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const run = await this.prisma.discoveryRun.create({
      data: {
        projectId,
        status: 'QUEUED',
        profileVersion: (previous?.version ?? 0) + 1,
        pipelineState: asJson({ budgets: this.budgetLimits() } satisfies RunPipelineState),
      },
    });

    await this.enqueue(run.id, projectId, reason);
    return run;
  }

  /**
   * Admin trigger: resumes an unfinished run for the project, or starts a new
   * one when there is nothing to resume.
   *
   * Resuming rather than re-creating matters twice over. A run already holds its
   * fetched pages and extracted facts, so duplicating it would pay for the whole
   * crawl and every LLM call again — the old repo's `build()` picked up a paused
   * run for the same reason. And it is the recovery path for a run left
   * `PAUSED` **without** a job: the process can die in the moment between
   * marking the run paused and enqueuing its continuation, and without this the
   * run would sit there forever.
   *
   * `RUNNING` is deliberately not resumable — BullMQ's own stall detection
   * already re-queues a job whose worker died, and enqueuing a second job for a
   * live run would put two workers on the same rows. `QUEUED` is not resumable
   * either, because a queued run always has its job: the one path that fails to
   * enqueue marks the run `FAILED`, which is resumable.
   */
  async rerun(clientId: string, projectId: string) {
    await this.assertProjectInClient(projectId, clientId);

    const resumable = await this.prisma.discoveryRun.findFirst({
      where: { projectId, status: { in: ['PAUSED', 'FAILED'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (resumable) {
      // Back to QUEUED so the row reads as "waiting to run" rather than showing
      // the pause/failure it is on its way out of; the worker flips it RUNNING.
      await this.prisma.discoveryRun.update({ where: { id: resumable.id }, data: { status: 'QUEUED', error: null } });
      await this.enqueue(resumable.id, projectId, 'retry');
      return resumable;
    }

    return this.startRun(projectId, 'manual');
  }

  /**
   * 404 rather than 403 when a project belongs to another client: whether that
   * project exists is itself not this caller's business.
   */
  private async assertProjectInClient(projectId: string, clientId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, clientId, deletedAt: null },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }
  }

  private async enqueue(
    discoveryRunId: string,
    projectId: string,
    reason: DiscoveryJobData['reason'],
  ): Promise<void> {
    const options = reason === 'continuation' ? DISCOVERY_CONTINUATION_JOB_OPTIONS : DISCOVERY_JOB_OPTIONS;
    try {
      await this.queue.add(DISCOVERY_JOB, { discoveryRunId, projectId, reason }, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Could not enqueue discovery run ${discoveryRunId}: ${message}`);
      await this.prisma.discoveryRun.update({
        where: { id: discoveryRunId },
        data: {
          status: 'FAILED',
          error: `Could not enqueue this run (the job queue may be unreachable): ${message}`,
          completedAt: new Date(),
        },
      });
    }
  }

  // ─── Consuming runs ─────────────────────────────────────────────────────

  /**
   * Runs one job: walks `STAGE_ORDER` from wherever the run got to, checkpointing
   * after every stage.
   *
   * Re-entrant by design — a BullMQ job-level retry, a paused run's continuation
   * job and a manual re-run all land here, and all resume from the `stage`
   * column rather than restarting. Every stage is written to tolerate that.
   */
  async executeRun(
    discoveryRunId: string,
    opts: { onProgress?: (stage: StageName) => void | Promise<void> } = {},
  ): Promise<void> {
    const run = await this.prisma.discoveryRun.findUnique({
      where: { id: discoveryRunId },
      include: { project: true },
    });
    if (!run) {
      throw new NotFoundException('Discovery run not found: ' + discoveryRunId);
    }
    if (TERMINAL_STATUSES.has(run.status)) {
      this.logger.debug(`Discovery run ${run.id} is already ${run.status} — nothing to do.`);
      return;
    }
    if (run.project.deletedAt) {
      await this.prisma.discoveryRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error: 'The project was archived before this run finished.', completedAt: new Date() },
      });
      return;
    }

    const state = readRunState(run.pipelineState);
    const limits: BudgetLimits = state.budgets ?? this.budgetLimits();
    const budget = new RunBudget(
      {
        pages: run.pagesSpent,
        requests: run.requestsSpent,
        chars: run.charsSpent,
        elapsedMs: run.elapsedMs,
      },
      limits,
    );

    const project: DiscoveryProjectRef = {
      id: run.project.id,
      name: run.project.name,
      domain: normalizeDomain(run.project.domain),
    };

    const ctx = new DiscoveryRunContextImpl(run.id, project, budget, state, this.prisma, this.logger, run.notes);

    // Status flips to RUNNING before the first stage: a run that is being worked
    // on must not read as QUEUED, or the admin UI shows a forever-pending run.
    await this.prisma.discoveryRun.update({
      where: { id: run.id },
      data: { status: 'RUNNING', startedAt: run.startedAt ?? new Date(), error: null },
    });

    const startIndex = run.stage ? STAGE_ORDER.indexOf(run.stage) : -1;
    const pending = STAGE_ORDER.slice(startIndex + 1);

    try {
      for (const stage of pending) {
        if (budget.deadlineReached()) {
          await this.pause(run.id, ctx, stage);
          return;
        }
        state.currentStage = stage;
        this.logger.debug(`Discovery run ${run.id}: stage ${stage}`);
        await this.stages[stage].run(ctx);
        await this.checkpoint(run.id, ctx, stage);
        await opts.onProgress?.(stage);
      }

      await this.finalise(run.id, ctx);
    } catch (err) {
      if (err instanceof RunPausedException) {
        // A stage hit the elapsed ceiling mid-way rather than between stages —
        // same outcome as the between-stages check above.
        await this.pause(run.id, ctx, err.stage as StageName);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Discovery run ${run.id} failed: ${message}`);
      // Record the failure but rethrow, so BullMQ's own attempts/backoff decide
      // whether to try again. The retry resumes from the `stage` column.
      await this.prisma.discoveryRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error: message, ...ctx.budget.snapshot(), pipelineState: asJson(ctx.state) },
      });
      throw err;
    }
  }

  /** Persists a stage boundary: the last completed stage, counters, and working state. */
  private async checkpoint(runId: string, ctx: DiscoveryRunContextImpl, completedStage: StageName): Promise<void> {
    await this.prisma.discoveryRun.update({
      where: { id: runId },
      data: { stage: completedStage, ...ctx.budget.snapshot(), pipelineState: asJson(ctx.state) },
    });
  }

  /**
   * Ends this job without ending the run: the elapsed budget is spent, work done
   * so far is checkpointed, and a continuation job picks up from here.
   *
   * `resumeStage` is the stage the continuation will start at — the next one
   * when the budget ran out between stages, or the stage that raised the pause
   * when it ran out inside one. The note says "at", not "before", because both
   * cases are real and only one of them is a boundary.
   */
  private async pause(runId: string, ctx: DiscoveryRunContextImpl, resumeStage: StageName): Promise<void> {
    await ctx.note(
      `Paused at the elapsed-time budget (${Math.round(ctx.budget.elapsedMs() / 1000)}s spent over ${ctx.budget.limits.maxElapsedMs / 1000}s per job) — a continuation job will resume at stage "${resumeStage}".`,
    );
    await this.prisma.discoveryRun.update({
      where: { id: runId },
      data: { status: 'PAUSED', ...ctx.budget.snapshot(), pipelineState: asJson(ctx.state) },
    });
    await this.enqueue(runId, ctx.project.id, 'continuation');
  }

  /**
   * Applies the spec doc's Definition-of-Done gates and closes the run.
   *
   * - **Identity below the confidence floor → `MANUAL_REVIEW_REQUIRED`.** Every
   *   later module keys off the identity this run resolved, so a weak identity
   *   is not a gap to proceed past.
   * - **Under 80% of the *fetched* pages actually analyzed → `COMPLETE_WITH_GAPS`.**
   *   The denominator is what we could reach, not what we selected — the same
   *   one the compile stage's own gate note uses, so the two never disagree.
   *   When both gates fail the identity one wins: it is the stronger signal, and
   *   a human reviewing the identity will see the coverage shortfall alongside it.
   */
  private async finalise(runId: string, ctx: DiscoveryRunContextImpl): Promise<void> {
    const profile = await this.prisma.companyContextProfile.findFirst({
      where: { discoveryRunId: runId },
      orderBy: { createdAt: 'desc' },
      select: { profileJson: true },
    });

    const identityConfidence = this.identityConfidence(profile?.profileJson);
    const { fetched, analyzed } = await this.analyzedCoverage(runId);

    // Why each gate failed is explained by the compile stage's own notes, which
    // compute the same two numbers — repeating the explanation here would leave
    // two versions of it to drift apart. This method only decides the label.
    let status: DiscoveryRunStatus = 'COMPLETE';
    if (profile === null) {
      status = 'MANUAL_REVIEW_REQUIRED';
      await ctx.note('The compile stage produced no profile — the run finished without a company-context profile to store.');
    } else if (identityConfidence < IDENTITY_CONFIDENCE_FLOOR) {
      status = 'MANUAL_REVIEW_REQUIRED';
    } else if (fetched > 0 && analyzed / fetched < REACHABLE_PAGES_FLOOR) {
      status = 'COMPLETE_WITH_GAPS';
    }

    await this.prisma.discoveryRun.update({
      where: { id: runId },
      data: { status, completedAt: new Date(), ...ctx.budget.snapshot(), pipelineState: asJson(ctx.state) },
    });
  }

  /**
   * The **identity decision's** confidence, read off `identity.company_type`:
   * the old code's `resolveIdentity` scale (0.2 unknown / 0.5 subsidiary /
   * 0.6 company with no legal name / 0.8 company with one).
   *
   * Deliberately not the fact-level confidence of `business_name`. That number
   * is a source-quality score on a different scale — nearly every fact clears
   * 0.8 — so gating on it would make the Definition-of-Done check a no-op and
   * let an unidentified company through as a complete run.
   */
  private identityConfidence(profileJson: unknown): number {
    if (!profileJson || typeof profileJson !== 'object') return 0;
    const companyType = (profileJson as CompanyContextProfileJson).identity?.company_type;
    return companyType && typeof companyType.confidence === 'number' ? companyType.confidence : 0;
  }

  /** Fetched-vs-analyzed page counts for the coverage gate — the compile stage's own denomination. */
  private async analyzedCoverage(runId: string): Promise<{ fetched: number; analyzed: number }> {
    const pages = await this.prisma.discoveredPage.findMany({
      where: { discoveryRunId: runId },
      select: { fetchStatus: true, pipelineState: true },
    });
    let fetched = 0;
    let analyzed = 0;
    for (const page of pages) {
      if (page.fetchStatus === 'FETCHED') fetched++;
      if (readPageState(page.pipelineState).extractStatus === 'done') analyzed++;
    }
    return { fetched, analyzed };
  }

  /** Budgets for a new run — env-overridable so a live run can be widened without a code change. */
  private budgetLimits(): BudgetLimits {
    const num = (key: string, fallback: number): number => {
      const raw = this.config.get<string | number>(key);
      const parsed = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };
    return {
      maxPages: num('DISCOVERY_MAX_PAGES', DEFAULT_MAX_PAGES),
      maxRequests: num('DISCOVERY_MAX_REQUESTS', DEFAULT_MAX_REQUESTS),
      maxChars: num('DISCOVERY_MAX_CHARS', DEFAULT_MAX_CHARS),
      maxElapsedMs: num('DISCOVERY_MAX_ELAPSED_MS', DEFAULT_MAX_ELAPSED_MS),
      maxRetriesPerPage: num('DISCOVERY_MAX_RETRIES_PER_PAGE', DEFAULT_MAX_RETRIES_PER_PAGE),
    };
  }

  // ─── Reading runs (staff-facing) ────────────────────────────────────────

  /** One run with its pages and notes — what an operator looks at when a profile looks wrong. */
  async getRun(clientId: string, discoveryRunId: string) {
    const run = await this.prisma.discoveryRun.findUnique({
      where: { id: discoveryRunId },
      include: { project: { select: { clientId: true } } },
    });
    if (!run || run.project.clientId !== clientId) {
      throw new NotFoundException('Discovery run not found.');
    }
    const pages = await this.prisma.discoveredPage.findMany({
      where: { discoveryRunId },
      orderBy: { url: 'asc' },
    });
    const profile = await this.prisma.companyContextProfile.findFirst({
      where: { discoveryRunId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    return {
      ...this.publicRun(run),
      pages: pages.map((page) => {
        const state = readPageState(page.pipelineState);
        return {
          id: page.id,
          url: page.url,
          pageType: page.pageType,
          fetchStatus: page.fetchStatus,
          discoverySource: state.discoverySource ?? null,
          title: state.title ?? null,
          selected: state.selected ?? false,
          selectionReason: state.selectionReason ?? null,
          extractStatus: state.extractStatus ?? 'pending',
          extractError: state.extractError ?? null,
          factCount: state.facts?.length ?? 0,
        };
      }),
      profileId: profile?.id ?? null,
    };
  }

  /** A project's run history, newest first. */
  async listRuns(clientId: string, projectId: string, take = 20) {
    await this.assertProjectInClient(projectId, clientId);
    const runs = await this.prisma.discoveryRun.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return runs.map((run) => this.publicRun(run));
  }

  /** The project's current company-context profile, or null when none has been built. */
  async latestProfile(clientId: string, projectId: string) {
    await this.assertProjectInClient(projectId, clientId);
    const profile = await this.prisma.companyContextProfile.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
    if (!profile) return null;
    return {
      id: profile.id,
      projectId: profile.projectId,
      discoveryRunId: profile.discoveryRunId,
      version: profile.version,
      overallConfidence: profile.overallConfidence,
      overallCompleteness: profile.overallCompleteness,
      profile: profile.profileJson,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  /** The project's social footprints, best-verified first. */
  async listSocialProfiles(clientId: string, projectId: string) {
    await this.assertProjectInClient(projectId, clientId);
    return this.prisma.socialProfile.findMany({
      where: { projectId },
      orderBy: [{ score: 'desc' }, { platform: 'asc' }],
    });
  }

  /**
   * Client corrections to the latest company-context profile (onboarding).
   * Applies `section.field` updates onto the newest profile row in place —
   * the client is authoritative over their own facts, so corrected values
   * keep `supported` status; untouched evidence stays for provenance.
   * Unknown paths and kind mismatches are 400s.
   */
  async updateProfileFields(clientId: string, projectId: string, fields: Record<string, unknown>) {
    await this.assertProjectInClient(projectId, clientId);
    const profile = await this.prisma.companyContextProfile.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
    if (!profile) {
      throw new NotFoundException('No company profile exists for this project yet.');
    }

    const json = structuredClone(profile.profileJson) as unknown as Record<string, Record<string, unknown>>;
    for (const [path, raw] of Object.entries(fields)) {
      const kind = EDITABLE_PROFILE_FIELDS[path];
      if (!kind) {
        throw new BadRequestException(`Unknown or non-editable field '${path}'.`);
      }
      const [section, field] = path.split('.');
      if (kind === 'scalar') {
        if (raw !== null && typeof raw !== 'string') {
          throw new BadRequestException(`Field '${path}' takes a string or null.`);
        }
        const trimmed = typeof raw === 'string' ? raw.trim() : null;
        if (trimmed !== null && trimmed.length > 2000) {
          throw new BadRequestException(`Field '${path}' must be at most 2000 characters.`);
        }
        const current = json[section][field] as ScalarField;
        json[section][field] =
          trimmed === null || trimmed === '' ? null : current ? { ...current, value: trimmed } : this.clientFact(trimmed);
      } else {
        if (!Array.isArray(raw) || !raw.every((v) => typeof v === 'string')) {
          throw new BadRequestException(`Field '${path}' takes an array of strings.`);
        }
        const values = raw.map((v) => v.trim()).filter((v) => v.length > 0);
        if (values.length > 50) {
          throw new BadRequestException(`Field '${path}' takes at most 50 values.`);
        }
        const current = (json[section][field] ?? []) as ArrayField;
        const byValue = new Map(current.map((f) => [f.value, f]));
        json[section][field] = values.map((v) => byValue.get(v) ?? this.clientFact(v));
      }
    }

    await this.prisma.companyContextProfile.update({
      where: { id: profile.id },
      data: { profileJson: asJson(json) },
    });
    return this.latestProfile(clientId, projectId);
  }

  /**
   * Corrects a social profile URL (onboarding). The old verification no
   * longer applies to a new URL, so verification resets to POSSIBLE with
   * no score — honest, not carried over.
   */
  async updateSocialProfile(clientId: string, projectId: string, id: string, url: string) {
    await this.assertProjectInClient(projectId, clientId);
    const existing = await this.prisma.socialProfile.findFirst({ where: { id, projectId } });
    if (!existing) {
      throw new NotFoundException('Social profile not found.');
    }
    const clean = url.trim();
    if (!/^[^\s@]+\.[^\s@]+(\/\S*)?$/.test(clean)) {
      throw new BadRequestException('url must look like a profile link (e.g. linkedin.com/company/acme).');
    }
    return this.prisma.socialProfile.update({
      where: { id },
      data: { url: clean, verificationStatus: 'POSSIBLE', score: null, verifiedAt: null },
    });
  }

  /** A client-supplied fact: authoritative, with no crawler evidence behind it. */
  private clientFact(value: string): FactValue {
    return {
      fact_id: randomUUID(),
      value,
      status: 'supported',
      fact_type: 'explicit',
      confidence: 1,
      last_checked_at: new Date().toISOString(),
      evidence_ids: [],
      evidence: [],
    };
  }

  private publicRun(run: {
    id: string;
    projectId: string;
    status: DiscoveryRunStatus;
    stage: string | null;
    pagesSpent: number;
    requestsSpent: number;
    charsSpent: number;
    elapsedMs: number;
    overallConfidence: number | null;
    overallCompleteness: number | null;
    profileVersion: number;
    error: string | null;
    notes: unknown;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: run.id,
      projectId: run.projectId,
      status: run.status,
      stage: run.stage,
      spent: {
        pages: run.pagesSpent,
        requests: run.requestsSpent,
        chars: run.charsSpent,
        elapsedMs: run.elapsedMs,
      },
      overallConfidence: run.overallConfidence,
      overallCompleteness: run.overallCompleteness,
      profileVersion: run.profileVersion,
      error: run.error,
      notes: Array.isArray(run.notes) ? (run.notes as string[]) : [],
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
    };
  }
}

/**
 * The `DiscoveryRunContext` a stage actually receives.
 *
 * Notes are written through immediately rather than at the next checkpoint —
 * they are the record of what a long stage was doing when it stopped, so
 * holding them in memory until a boundary would defeat their purpose.
 */
class DiscoveryRunContextImpl implements DiscoveryRunContext {
  private readonly notes: string[];

  constructor(
    readonly runId: string,
    readonly project: DiscoveryProjectRef,
    readonly budget: RunBudget,
    readonly state: RunPipelineState,
    private readonly prisma: PrismaService,
    readonly logger: Logger,
    existingNotes: unknown,
  ) {
    this.notes = Array.isArray(existingNotes) ? (existingNotes as string[]) : [];
  }

  async note(text: string): Promise<void> {
    this.notes.push(text);
    await this.prisma.discoveryRun.update({
      where: { id: this.runId },
      data: { notes: this.notes },
    });
  }

  async checkpoint(): Promise<void> {
    await this.prisma.discoveryRun.update({
      where: { id: this.runId },
      data: { ...this.budget.snapshot(), pipelineState: asJson(this.state) },
    });
  }
}
