/**
 * SERP-based competitor discovery — a small, bounded set of category-level
 * queries (terms drawn from the project's own `CompanyContextProfile`, not
 * hand-typed), run through the already-shared `DataForSeoSerpService`.
 * Every distinct ranking domain other than the project's own is a
 * discovered competitor candidate.
 *
 * @module competitors/services/serp-discovery.service
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { DataForSeoSerpService } from '../../discovery/services/dataforseo-serp.service.js';
import type { CompanyContextProfileJson } from '../../discovery/discovery.types.js';
import { MAX_SERP_DOMAINS_PER_QUERY, MAX_SERP_QUERIES } from '../competitors.constants.js';

export interface SerpDiscoveryResult {
  domains: string[];
  queriesRun: number;
  costUsd: number;
  skipped: string | null;
}

@Injectable()
export class SerpDiscoveryService {
  private readonly logger = new Logger(SerpDiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly serp: DataForSeoSerpService,
  ) {}

  async discover(projectId: string, ownDomain: string): Promise<SerpDiscoveryResult> {
    const profile = await this.prisma.companyContextProfile.findFirst({ where: { projectId }, orderBy: { version: 'desc' } });
    if (!profile) {
      return { domains: [], queriesRun: 0, costUsd: 0, skipped: 'No CompanyContextProfile exists yet for this project. Run Discovery first.' };
    }

    const queries = buildQueries(profile.profileJson as unknown as CompanyContextProfileJson);
    if (queries.length === 0) {
      return { domains: [], queriesRun: 0, costUsd: 0, skipped: 'CompanyContextProfile has no usable category/industry/service terms to search on.' };
    }

    const ownHost = normalizeHost(ownDomain);
    const found = new Set<string>();
    let costUsd = 0;
    let anySucceeded = false;
    let lastSkipReason: string | null = null;

    for (const query of queries) {
      const result = await this.serp.search(query);
      costUsd += result.costUsd;
      if (result.skipped) {
        lastSkipReason = result.skipped;
        continue;
      }
      anySucceeded = true;
      for (const link of result.links.slice(0, MAX_SERP_DOMAINS_PER_QUERY)) {
        const host = safeHost(link.url);
        if (host && host !== ownHost) found.add(host);
      }
    }

    return {
      domains: [...found],
      queriesRun: queries.length,
      costUsd,
      skipped: anySucceeded ? null : lastSkipReason,
    };
  }
}

/**
 * Up to `MAX_SERP_QUERIES` category-level queries from the profile's own
 * fields — company type, first industry, first service — never
 * hand-typed, never a guess at what the business does.
 */
function buildQueries(profile: CompanyContextProfileJson): string[] {
  const candidates: string[] = [];
  const companyType = profile.identity?.company_type?.value?.trim();
  if (companyType) candidates.push(`${companyType} companies`);

  const industry = profile.customers?.industries?.[0]?.value?.trim();
  if (industry) candidates.push(`${industry} companies`);

  const service = profile.offerings?.services?.[0]?.value?.trim();
  if (service) candidates.push(`${service} providers`);

  return [...new Set(candidates)].slice(0, MAX_SERP_QUERIES);
}

function normalizeHost(domain: string): string {
  return domain
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]!
    .trim()
    .toLowerCase();
}

function safeHost(url: string): string | null {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return null;
  }
}
