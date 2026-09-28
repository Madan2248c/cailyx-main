/**
 * Social Activity orchestrator — run lifecycle, Apify pulls, aggregation,
 * findings, deltas, persistence. Mirrors TechnicalAuditService's lifecycle
 * (startRun → queue → executeRun → COMPLETE/FAILED) with the spend discipline
 * from docs/analysis/digital-presence-audit.md layered on top.
 *
 * Spend order is load-bearing: `confirmSpend` is verified at trigger time
 * (HTTP) and re-verified from the stored row/schedule before the adapter is
 * ever touched. A run that will never pull cannot masquerade as one that did.
 *
 * @module social-activity/services/social-activity.service
 */

import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { AuditEvents } from '../../../common/events/audit-events.js';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { LlmService } from '../../llm/llm.service.js';
import {
  DEFAULT_MAX_COST_PER_RUN_USD,
  DEFAULT_POSTS_PER_PLATFORM,
  DEFAULT_WINDOW_DAYS,
} from '../social-activity.constants.js';
import type {
  PlatformActivity,
  SocialActivityFinding,
  SocialActivityPlatform,
  SocialActivityTarget,
} from '../social-activity.types.js';
import { ALL_SOCIAL_PLATFORMS, DEFAULT_SOCIAL_PLATFORMS } from '../social-activity.types.js';
import { ApifyService } from './apify.service.js';
import {
  aggregatePlatform,
  deltasFor,
  findingsFor,
} from './social-activity.aggregation.js';
import {
  SOCIAL_ACTIVITY_JOB,
  SOCIAL_ACTIVITY_JOB_OPTIONS,
  SOCIAL_ACTIVITY_QUEUE,
  type SocialActivityJobData,
} from '../queue/social-activity.queue.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
function asJson(value: unknown): any {
  return JSON.parse(JSON.stringify(value ?? null)) as any;
}

export interface StartRunOptions {
  platforms?: SocialActivityPlatform[];
  postsPerPlatform?: number;
  windowDays?: number;
  includeProbable?: boolean;
}

const LINKEDIN_PERSON_RE = /linkedin\.com\/in\//i;

@Injectable()
export class SocialActivityService {
  private readonly logger = new Logger(SocialActivityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly apify: ApifyService,
    private readonly llm: LlmService,
    @InjectQueue(SOCIAL_ACTIVITY_QUEUE) private readonly queue: Queue<SocialActivityJobData>,
    @Optional() private readonly auditEvents?: AuditEvents,
  ) {}

  // ─── Producing runs ─────────────────────────────────────────────────────

  /**
   * Creates a `social_activity_runs` row for a project and queues it.
   * Does NOT check spend — triggers (`rerun`, the scheduled tick) own the
   * opt-in decision; by the time a row exists, spending was approved.
   * Returns the active run instead of creating a second one.
   */
  async startRun(projectId: string, reason: SocialActivityJobData['reason'] = 'manual', opts: StartRunOptions = {}) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, deletedAt: null } });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    const active = await this.prisma.socialActivityRun.findFirst({
      where: { projectId, status: { in: ['QUEUED', 'RUNNING'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (active) {
      this.logger.debug(`Social activity for project ${projectId} already ${active.status} (${active.id}) — not starting another.`);
      return active;
    }

    const previous = await this.prisma.socialActivityRun.findFirst({
      where: { projectId, status: 'COMPLETE' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    const run = await this.prisma.socialActivityRun.create({
      data: {
        projectId,
        status: 'QUEUED',
        triggeredBy: reason === 'scheduled' ? 'SCHEDULED' : 'MANUAL',
        previousRunId: previous?.id ?? null,
        platforms: opts.platforms ?? [...DEFAULT_SOCIAL_PLATFORMS],
        postsPerPlatform: opts.postsPerPlatform ?? DEFAULT_POSTS_PER_PLATFORM,
        windowDays: opts.windowDays ?? DEFAULT_WINDOW_DAYS,
        includeProbable: opts.includeProbable ?? false,
      },
    });

    await this.enqueue(run.id, projectId, reason);
    return run;
  }

  /**
   * Admin trigger: requires explicit `confirmSpend: true` in the body —
   * without it, 400 and nothing was run, nothing was spent. Unknown
   * platform names also 400 (never silently dropped from a paid pull).
   */
  async rerun(
    clientId: string,
    projectId: string,
    body: Omit<StartRunOptions, 'platforms'> & { confirmSpend?: boolean; platforms?: string[] },
  ) {
    await this.assertProjectInClient(projectId, clientId);
    if (body.confirmSpend !== true) {
      throw new BadRequestException(
        'Social-activity pulls spend real Apify credit. Pass confirmSpend: true — nothing was run and nothing was spent.',
      );
    }
    const platforms = body.platforms ?? [...DEFAULT_SOCIAL_PLATFORMS];
    const unknown = platforms.filter((p) => !(ALL_SOCIAL_PLATFORMS as readonly string[]).includes(p));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown platforms: ${unknown.join(', ')}.`);
    }
    return this.startRun(projectId, 'manual', { ...body, platforms: platforms as SocialActivityPlatform[] });
  }

  private async assertProjectInClient(projectId: string, clientId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, clientId, deletedAt: null },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }
  }

  private async enqueue(runId: string, projectId: string, reason: SocialActivityJobData['reason']): Promise<void> {
    try {
      await this.queue.add(SOCIAL_ACTIVITY_JOB, { socialActivityRunId: runId, projectId, reason }, SOCIAL_ACTIVITY_JOB_OPTIONS);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Could not enqueue social activity run ${runId}: ${message}`);
      await this.prisma.socialActivityRun.update({
        where: { id: runId },
        data: { status: 'FAILED', completedAt: new Date() },
      });
    }
  }

  // ─── Executing runs ─────────────────────────────────────────────────────

  async executeRun(runId: string): Promise<void> {
    const run = await this.prisma.socialActivityRun.findUnique({ where: { id: runId } });
    if (!run || run.status === 'COMPLETE' || run.status === 'FAILED') return; // terminal rows no-op on retry

    // Fail closed when the key vanished between trigger and execution.
    if (!this.apify.enabled) {
      await this.prisma.socialActivityRun.update({
        where: { id: runId },
        data: { status: 'FAILED', completedAt: new Date() },
      });
      this.logger.error(`Social activity run ${runId}: APIFY_API_KEY not configured — run failed closed.`);
      return;
    }

    await this.prisma.socialActivityRun.update({
      where: { id: runId },
      data: { status: 'RUNNING', startedAt: run.startedAt ?? new Date() },
    });

    try {
      const targets = await this.resolveTargets(run.projectId, run.platforms, run.includeProbable);
      const maxCost = this.config.get<number>('SOCIAL_MAX_COST_PER_RUN_USD') ?? DEFAULT_MAX_COST_PER_RUN_USD;

      const findings: SocialActivityFinding[] = [];
      const aggregates: PlatformActivity[] = [];
      let totalCostUsd = 0;
      let ceilingHit = false;

      // Sequential in config order — the cost ceiling needs ordering.
      for (const target of targets) {
        if (totalCostUsd >= maxCost) {
          ceilingHit = true;
          findings.push({
            type: 'cost-ceiling',
            platform: target.platform,
            status: 'not-run',
            severity: 'info',
            detail: `${target.platform} skipped: run crossed the $${maxCost} actor-spend ceiling.`,
          });
          continue;
        }
        const pulled = await this.apify.run([target], run.postsPerPlatform);
        totalCostUsd += pulled.totalCostUsd;

        for (const skipped of pulled.skipped) {
          findings.push({
            type: 'no-account',
            platform: skipped.platform,
            status: 'not-run',
            severity: 'info',
            detail: skipped.reason,
          });
        }
        for (const role of pulled.results) {
          if (role.error) {
            findings.push({
              type: 'pull-error',
              platform: role.platform,
              status: 'error',
              severity: 'warn',
              detail: `${role.role} pull via ${role.actorId} failed: ${role.error}`,
            });
            continue;
          }
          await this.persistItems(runId, run.projectId, role.items);
        }
      }

      // Aggregate per platform from everything persisted for this run.
      const stored = await this.prisma.socialPost.findMany({ where: { socialActivityRunId: runId } });
      const now = new Date();
      for (const platform of run.platforms as SocialActivityPlatform[]) {
        const rows = stored
          .filter((s) => s.platform === platform)
          .map((s) => ({
            platform: s.platform,
            kind: s.kind as 'profile' | 'post',
            postedAt: s.postedAt,
            likeCount: s.likeCount,
            commentCount: s.commentCount,
            shareCount: s.shareCount,
            followerCount: s.followerCount,
          }));
        if (rows.length === 0 && !findings.some((f) => f.platform === platform)) {
          findings.push({
            type: 'no-data',
            platform,
            status: 'not-run',
            severity: 'info',
            detail: `No rows pulled for ${platform} — no verified account on file or pull skipped.`,
          });
          continue;
        }
        if (rows.length === 0) continue;
        const activity = aggregatePlatform(platform, rows, run.windowDays, run.postsPerPlatform, now);
        aggregates.push(activity);
        findings.push(...findingsFor(activity));
      }

      const previous = run.previousRunId
        ? await this.prisma.socialActivityRun.findUnique({ where: { id: run.previousRunId } })
        : null;
      const prevAggregates = previous ? ((previous.result as { platforms?: PlatformActivity[] })?.platforms ?? []) : [];
      const deltas = deltasFor(prevAggregates, aggregates);

      await this.prisma.socialActivityRun.update({
        where: { id: runId },
        data: {
          status: 'COMPLETE',
          completedAt: new Date(),
          totalCostUsd,
          result: asJson({ platforms: aggregates, ceilingHit }),
          findings: asJson(findings),
          deltas: asJson(deltas),
        },
      });
      this.logger.log(
        `Social activity complete for project ${run.projectId}: ${aggregates.length} platforms, $${totalCostUsd.toFixed(3)} spend`,
      );
      this.auditEvents?.completed({ module: 'social-activity', projectId: run.projectId, runId });

      // Post-persist narrative: best-effort, never throws, never touches numbers.
      await this.writeNarrative(runId).catch((err) => {
        this.logger.warn(`Narrative step failed for run ${runId}: ${(err as Error).message}`);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Social activity run ${runId} failed: ${message}`);
      await this.prisma.socialActivityRun.update({
        where: { id: runId },
        data: { status: 'FAILED', completedAt: new Date() },
      });
    }
  }

  /**
   * Verified company profiles only: VERIFIED status (+ PROBABLE when the run
   * opted in), social-group platforms in the run's set, personal shapes
   * excluded. Handles parsed from verified URLs — never fresh-guessed.
   */
  private async resolveTargets(
    projectId: string,
    platforms: string[],
    includeProbable: boolean,
  ): Promise<SocialActivityTarget[]> {
    const statuses = includeProbable ? (['VERIFIED', 'PROBABLE'] as const) : (['VERIFIED'] as const);
    const profiles = await this.prisma.socialProfile.findMany({
      where: { projectId, verificationStatus: { in: [...statuses] }, platform: { in: platforms } },
    });
    const targets: SocialActivityTarget[] = [];
    for (const platform of platforms as SocialActivityPlatform[]) {
      const profile = profiles.find((p) => p.platform === platform);
      if (!profile) continue;
      if (platform === 'linkedin' && LINKEDIN_PERSON_RE.test(profile.url)) continue; // founder, not the company
      const handle = handleFromUrl(platform, profile.url);
      if (!profile.url && !handle) continue;
      targets.push({ platform, url: profile.url, handle });
    }
    return targets;
  }

  private async persistItems(
    runId: string,
    projectId: string,
    items: Array<{
      platform: string;
      kind: 'profile' | 'post';
      postedAt: string | null;
      url: string | null;
      caption: string | null;
      likeCount: number | null;
      commentCount: number | null;
      shareCount: number | null;
      viewCount: number | null;
      followerCount: number | null;
      followingCount: number | null;
      postCount: number | null;
      actorId: string;
      raw: string;
    }>,
  ): Promise<void> {
    const CHUNK = 100;
    for (let i = 0; i < items.length; i += CHUNK) {
      const chunk = items.slice(i, i + CHUNK);
      await this.prisma.socialPost.createMany({
        data: chunk.map((item) => ({
          socialActivityRunId: runId,
          projectId,
          platform: item.platform,
          kind: item.kind,
          postedAt: item.postedAt ? new Date(item.postedAt) : null,
          url: item.url,
          caption: item.caption,
          likeCount: item.likeCount,
          commentCount: item.commentCount,
          shareCount: item.shareCount,
          viewCount: item.viewCount,
          followerCount: item.followerCount,
          followingCount: item.followingCount,
          postCount: item.postCount,
          actorId: item.actorId,
          raw: item.raw ? JSON.parse(item.raw) : {},
        })),
      });
    }
  }

  private async writeNarrative(runId: string): Promise<void> {
    const run = await this.prisma.socialActivityRun.findUnique({ where: { id: runId } });
    if (!run) return;
    const aggregates = ((run.result as { platforms?: PlatformActivity[] })?.platforms ?? []) as PlatformActivity[];
    const findings = (run.findings ?? []) as unknown as SocialActivityFinding[];
    const lines = aggregates.map(
      (a) =>
        `${a.platform}: pattern=${a.pattern}, postsInWindow=${a.postsInWindow}, daysSinceLast=${a.daysSinceLastPost?.toFixed(1) ?? 'n/a'}, followers=${a.followerCount ?? 'n/a'}, avgEngagement=${a.avgEngagement?.toFixed(1) ?? 'n/a'}`,
    );
    const result = await this.llm.json<string>(
      {
        system: `You are the analyst writing the short standing commentary an operator reads before a client call about their company's social publishing audit.

Write exactly three Markdown sections, in this order, and nothing before the first heading:
## Verdict
## What changed
## What to verify live

Rules:
- Be quantitative. Cite the real numbers you were given. Never invent a number that isn't in the input.
- Total output under 250 words. No recommendations, no advice — describe the data only.
- Respond with ONLY JSON: {"narrative": string}.`,
        user: `Platforms:\n${lines.join('\n')}\nFindings: ${findings.map((f) => `${f.platform}:${f.type}:${f.status}`).join(', ') || 'none'}`,
        maxTokens: 500,
        purpose: 'social-activity-narrative',
      },
      (raw) => {
        const narrative = (raw as { narrative?: unknown }).narrative;
        if (typeof narrative !== 'string' || !narrative.trim()) throw new Error('narrative missing');
        return narrative;
      },
    );
    await this.prisma.socialActivityRun.update({
      where: { id: runId },
      data: { narrative: result.data, narrativeModel: result.model },
    });
  }

  // ─── Reads ──────────────────────────────────────────────────────────────

  async getRun(clientId: string, runId: string) {
    const run = await this.prisma.socialActivityRun.findFirst({
      where: { id: runId, project: { clientId, deletedAt: null } },
      include: { project: { select: { id: true, name: true, domain: true } } },
    });
    if (!run) throw new NotFoundException('Run not found.');
    return run;
  }

  async listRuns(clientId: string, projectId: string, take = 20) {
    await this.assertProjectInClient(projectId, clientId);
    return this.prisma.socialActivityRun.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, 100),
    });
  }

  async getComparison(clientId: string, runId: string) {
    const run = await this.getRun(clientId, runId);
    const previous = run.previousRunId
      ? await this.prisma.socialActivityRun.findFirst({
          where: { id: run.previousRunId, project: { clientId, deletedAt: null } },
        })
      : null;
    return {
      currentRunId: run.id,
      previousRunId: previous?.id ?? null,
      currentAt: run.completedAt,
      previousAt: previous?.completedAt ?? null,
      deltas: run.deltas,
    };
  }
}

/**
 * Handle parsed from an already-verified profile URL — consuming, not
 * discovering. Last-path-segment heuristics per platform; null when the URL
 * carries no handle (the pull then goes by URL alone, or skips with reason).
 */
export function handleFromUrl(platform: SocialActivityPlatform, url: string): string | null {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return null;
    const last = segments[segments.length - 1]!;
    switch (platform) {
      case 'linkedin': {
        // /company/<slug> or /school/<slug> — /in/<slug> is a person (excluded upstream).
        const i = segments.findIndex((s) => s === 'company' || s === 'school' || s === 'showcase');
        return i >= 0 && segments[i + 1] ? segments[i + 1]! : null;
      }
      case 'youtube': {
        if (last.startsWith('@')) return last;
        const i = segments.findIndex((s) => s === 'channel' || s === 'c' || s === 'user');
        return i >= 0 && segments[i + 1] ? segments[i + 1]! : null;
      }
      case 'tiktok':
        return last.startsWith('@') ? last : `@${last}`;
      case 'instagram':
      case 'facebook':
      case 'x':
        return last.startsWith('@') ? last.slice(1) : last;
    }
  } catch {
    return null;
  }
}
