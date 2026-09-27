/**
 * Competitors orchestrator — discovery (AEO's stance_discovered rows +
 * SERP-discovered domains), per-domain profiling (competitors + the
 * project's own domain, same code path), and the deterministic gap
 * comparison. See docs/analysis/competitors.md and module README.
 *
 * @module competitors/services/competitors.service
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { AeoAuditService } from '../../aeo-audit/services/aeo-audit.service.js';
import type { AeoVerdict, CompetitorStanding } from '../../aeo-audit/aeo-audit.types.js';
import type { DomainProfile } from '../competitors.types.js';
import { HomepageProfilerService } from './homepage-profiler.service.js';
import { SerpDiscoveryService } from './serp-discovery.service.js';

function asJson(value: unknown): any {
  return JSON.parse(JSON.stringify(value ?? null)) as any;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export interface GapRow {
  competitorId: string | null;
  name: string;
  domain: string | null;
  profile: {
    techStackFindings: unknown;
    schemaTypes: unknown;
    seoScore: number | null;
    seoIssues: unknown;
    reviewRating: unknown;
    fetchStatus: string;
  } | null;
  aeoStanding: CompetitorStanding | null;
}

@Injectable()
export class CompetitorsService {
  private readonly logger = new Logger(CompetitorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly serpDiscovery: SerpDiscoveryService,
    private readonly profiler: HomepageProfilerService,
    private readonly aeoAudit: AeoAuditService,
  ) {}

  /**
   * Runs SERP discovery, upserts every distinct domain as `serp_discovered`
   * (AEO's own `stance_discovered` rows need no new work — they already
   * exist), then profiles every tracked competitor plus the project's own
   * domain. Synchronous: a handful of homepage fetches, not a crawl — no
   * background queue needed, same reasoning as the old repo's tech-stack
   * module.
   */
  async discover(clientId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null } });
    if (!project) throw new NotFoundException('Project not found.');

    const serpResult = await this.serpDiscovery.discover(projectId, project.domain);
    let upserted = 0;
    for (const domain of serpResult.domains) {
      const existing = await this.prisma.competitor.findFirst({ where: { projectId, domain } });
      if (existing) continue;
      await this.prisma.competitor.create({ data: { projectId, name: domain, domain, status: 'candidate', source: 'serp_discovered' } });
      upserted++;
    }

    const competitors = await this.prisma.competitor.findMany({ where: { projectId } });

    // The project's own domain, same profiling path — competitorId: null.
    const ownProfile = await this.profiler.profile(project.domain);
    await this.persistProfile(projectId, null, ownProfile);

    let profiled = 0;
    for (const competitor of competitors) {
      if (!competitor.domain) continue; // a manually-added competitor with no domain can't be fetched
      const profile = await this.profiler.profile(competitor.domain);
      await this.persistProfile(projectId, competitor.id, profile);
      profiled++;
    }

    return {
      serpQueriesRun: serpResult.queriesRun,
      serpCostUsd: serpResult.costUsd,
      serpSkipped: serpResult.skipped,
      competitorsDiscovered: upserted,
      competitorsProfiled: profiled,
      ownDomainProfiled: true,
    };
  }

  /** Manual add fallback — a rival the automatic paths missed. */
  async create(clientId: string, projectId: string, input: { name: string; domain?: string }) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null } });
    if (!project) throw new NotFoundException('Project not found.');
    return this.prisma.competitor.create({ data: { projectId, name: input.name, domain: input.domain, status: 'tracked', source: 'manual' } });
  }

  /**
   * Client corrections to a competitor (onboarding): fix the name/domain,
   * confirm a candidate (`tracked`) or demote a tracked rival
   * (`candidate`). Scoped to the project — a client can only touch their
   * own rows. At least one field must change.
   */
  async updateCompetitor(
    clientId: string,
    projectId: string,
    id: string,
    input: { name?: string; domain?: string | null; status?: 'tracked' | 'candidate' },
  ) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null } });
    if (!project) throw new NotFoundException('Project not found.');
    const existing = await this.prisma.competitor.findFirst({ where: { id, projectId } });
    if (!existing) throw new NotFoundException('Competitor not found.');

    const data: { name?: string; domain?: string | null; status?: 'tracked' | 'candidate' } = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length === 0) throw new BadRequestException('Competitor name must not be empty.');
      data.name = input.name.trim();
    }
    if (input.domain !== undefined) {
      data.domain = input.domain === null ? null : input.domain.trim() || null;
    }
    if (input.status !== undefined) {
      if (input.status !== 'tracked' && input.status !== 'candidate') {
        throw new BadRequestException("Competitor status must be 'tracked' or 'candidate'.");
      }
      data.status = input.status;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nothing to update — provide name, domain, or status.');
    }
    return this.prisma.competitor.update({ where: { id }, data });
  }

  /** Every tracked competitor plus each one's latest profile. */
  async list(clientId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null } });
    if (!project) throw new NotFoundException('Project not found.');

    const competitors = await this.prisma.competitor.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
    const out = [];
    for (const c of competitors) {
      const profile = await this.prisma.competitorProfile.findFirst({ where: { competitorId: c.id }, orderBy: { createdAt: 'desc' } });
      out.push({ ...c, latestProfile: profile ?? null });
    }
    return out;
  }

  /**
   * Plain client-vs-competitor comparison. No LLM judgment — counted
   * numbers only, matching every other pipeline module's discipline.
   * AEO standing is read live from the latest completed audit's verdict
   * (never persisted onto a profile row) and matched to a competitor by
   * normalized name — `competitorStanding` carries no id of its own.
   */
  async getGap(clientId: string, projectId: string): Promise<{ own: GapRow; competitors: GapRow[] }> {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null } });
    if (!project) throw new NotFoundException('Project not found.');

    const standingByName = await this.latestCompetitorStanding(clientId, projectId);

    const ownProfile = await this.prisma.competitorProfile.findFirst({ where: { projectId, competitorId: null }, orderBy: { createdAt: 'desc' } });
    const own: GapRow = {
      competitorId: null,
      name: project.name,
      domain: project.domain,
      profile: ownProfile ? toProfileSummary(ownProfile) : null,
      aeoStanding: null, // the client is the subject, not a rival to itself
    };

    const competitors = await this.prisma.competitor.findMany({ where: { projectId, status: 'tracked' }, orderBy: { createdAt: 'asc' } });
    const rows: GapRow[] = [];
    for (const c of competitors) {
      const profile = await this.prisma.competitorProfile.findFirst({ where: { competitorId: c.id }, orderBy: { createdAt: 'desc' } });
      rows.push({
        competitorId: c.id,
        name: c.name,
        domain: c.domain,
        profile: profile ? toProfileSummary(profile) : null,
        aeoStanding: standingByName.get(normalizeName(c.name)) ?? null,
      });
    }

    return { own, competitors: rows };
  }

  private async latestCompetitorStanding(clientId: string, projectId: string): Promise<Map<string, CompetitorStanding>> {
    const audits = await this.aeoAudit.list(clientId, projectId);
    const latest = audits.find((a: { status: string }) => a.status === 'completed');
    if (!latest) return new Map();
    const verdict = (await this.aeoAudit.getVerdict(clientId, latest.id)) as AeoVerdict;
    return new Map(verdict.counted.competitorStanding.map((c) => [normalizeName(c.name), c]));
  }

  private async persistProfile(projectId: string, competitorId: string | null, profile: DomainProfile): Promise<void> {
    await this.prisma.competitorProfile.create({
      data: {
        projectId,
        competitorId,
        techStackFindings: asJson(profile.techStackFindings),
        schemaTypes: asJson(profile.schemaTypes),
        seoScore: profile.seoScore,
        seoIssues: asJson(profile.seoIssues),
        reviewRating: profile.reviewRating ? asJson(profile.reviewRating) : undefined,
        fetchStatus: profile.fetchStatus,
        error: profile.error,
      },
    });
  }
}

function toProfileSummary(row: {
  techStackFindings: unknown;
  schemaTypes: unknown;
  seoScore: number | null;
  seoIssues: unknown;
  reviewRating: unknown;
  fetchStatus: string;
}) {
  return {
    techStackFindings: row.techStackFindings,
    schemaTypes: row.schemaTypes,
    seoScore: row.seoScore,
    seoIssues: row.seoIssues,
    reviewRating: row.reviewRating,
    fetchStatus: row.fetchStatus,
  };
}
