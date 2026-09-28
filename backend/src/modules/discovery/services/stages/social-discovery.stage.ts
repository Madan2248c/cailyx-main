/**
 * Stage 7 — Social discovery.
 *
 * Three passes, in this order, and the order is the whole design:
 *
 * 1. **Same-site crawl** (`PresenceDiscoveryService.crawl`) — the proven
 *    footer/JSON-LD `sameAs` mechanics. Free, and it finds what the client
 *    deliberately links.
 * 2. **SERP fallback** (`PresenceSerpService.sweep`) — only for platforms the
 *    crawl did *not* find, and only for platforms this business is expected to
 *    have at all. Spending paid search credits on an Instagram account for a
 *    B2B consultancy nobody would look for is worse than not looking.
 * 3. **Our own scoring pass** (`SocialVerificationService`) — the spec doc's
 *    point table, which is what actually decides `verification_status`. A SERP
 *    result is a candidate for this pass, never a conclusion.
 *
 * See docs/analysis/discovery.md, "Social profile verification — reconciled
 * design" and "SERP fallback for platforms same-site discovery didn't find".
 *
 * ## Why the sweep budget is tracked in the run's state
 *
 * `PRESENCE_SERP_MAX_QUERIES` is a per-sweep ceiling inside
 * `PresenceSerpService`, but a run can be re-enqueued many times, and each
 * re-enqueue would otherwise start a fresh sweep over the same platforms. So
 * this stage records every platform it has swept and how much it has spent in
 * `ctx.state.search`, and refuses to sweep again once the cumulative count
 * reaches the cap. That is what makes the documented ceiling a ceiling on the
 * *run*, not just on one call.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../../prisma/prisma.service.js';
import { SOCIAL_METHOD_TO_PRISMA, SOCIAL_STATUS_TO_PRISMA } from '../../discovery.types.js';
import type { ReconciledFact, ScoredSocialProfile } from '../../discovery.types.js';
import type { DiscoveryRunContext } from '../pipeline-context.js';
import { dedupeBy } from '../pipeline-utils.js';
import { PresenceDiscoveryService, type DiscoveredAccount } from '../presence-discovery.service.js';
import { PresenceSerpService } from '../presence-serp.service.js';
import { EXPECTED_BY_PROFILE, EXPECTED_PLATFORMS, inferBusinessProfile, PLATFORM_LABELS } from '../presence.types.js';
import type { PresencePlatform } from '../presence.types.js';
import { SocialVerificationService, type SocialCandidate } from '../social-verification.service.js';

/** Page ceiling for the same-site crawl — footers repeat, deeper costs more for nothing. */
const CRAWL_MAX_PAGES = 4;

/**
 * Mirror of `PresenceSerpService`'s own default for `PRESENCE_SERP_MAX_QUERIES`
 * — the env var is the single source of truth, and this only has to agree with
 * it when the var is unset. Duplicated rather than imported because the
 * constant lives in `presence-serp.service.ts`, which is ported code kept
 * verbatim.
 */
const SERP_QUERY_CAP_DEFAULT = 20;

@Injectable()
export class SocialDiscoveryStage {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly presenceDiscovery: PresenceDiscoveryService,
    private readonly presenceSerp: PresenceSerpService,
    private readonly verification: SocialVerificationService,
  ) {}

  async run(ctx: DiscoveryRunContext): Promise<void> {
    const domain = ctx.project.domain;
    const identity = {
      brand: ctx.project.name,
      domain,
      location: singleFactValue(ctx, 'headquarters'),
    };

    // ── 1. Same-site discovery ────────────────────────────────────────────
    const { accounts, pagesFetched } = await this.presenceDiscovery.crawl(domain, ctx.runId, CRAWL_MAX_PAGES);
    ctx.budget.spendRequests(pagesFetched);

    // Same URL seen twice (a `sameAs` and a footer link) is one profile; the
    // JSON-LD declaration outranks the link, which `crawl` already decided.
    const found = dedupeBy(accounts, (a) => a.url);
    const foundPlatforms = new Set(found.map((a) => a.platform));
    await ctx.note(
      `Social discovery: same-site crawl read ${pagesFetched} page(s) and found ${found.length} profile(s) ` +
        `across ${foundPlatforms.size} platform(s).`,
    );

    // ── 2. SERP fallback, only for expected platforms still missing ───────
    const expected = expectedPlatformsFor(singleFactValue(ctx, 'category'));
    const missingAfterCrawl = expected.filter((p) => !foundPlatforms.has(p));
    const serpCandidates = await this.serpFallback(ctx, missingAfterCrawl);

    // ── 3. Score everything, then persist what survived ───────────────────
    const candidates: SocialCandidate[] = [...found.map(accountToCandidate), ...serpCandidates];
    const { scored, fetches, prefilted } = await this.verification.scoreAll(
      candidates,
      identity,
      ctx.budget.requestsLeft(),
    );
    ctx.budget.spendRequests(fetches);

    const survivors = scored.filter((s) => s.profile.status !== 'rejected');
    // A founder's personal profile is real, but it is not the company's digital
    // presence — `presence.types` is explicit that personal rows stay out of the
    // company footprint, so they are reported, not stored.
    const stored = survivors.filter((s) => candidateEntity(found, serpCandidates, s.profile.url) !== 'personal');
    const personalSkipped = survivors.length - stored.length;

    for (const { profile } of stored) {
      await this.upsertProfile(ctx, profile);
    }

    if (prefilted.length > 0) {
      await ctx.note(
        `Social discovery: ${prefilted.length} search candidate(s) scored below the name-similarity floor ` +
          `(${prefilted.map((c) => PLATFORM_LABELS[c.platform] ?? c.platform).join(', ')}). Not verified, and ` +
          `not stored. Not finding an account is the honest outcome here.`,
      );
    }
    const rejected = scored.filter((s) => s.rejection !== null);
    if (rejected.length > 0) {
      await ctx.note(
        `Social discovery: rejected ${rejected.length} candidate(s); ` +
          rejected.map((r) => `${r.profile.url} (${r.rejection})`).join('; '),
      );
    }
    if (personalSkipped > 0) {
      await ctx.note(
        `Social discovery: ${personalSkipped} candidate(s) looked like a person's own profile rather than the ` +
          `company's. Recorded as personal, not stored as company presence.`,
      );
    }

    await ctx.note(
      `Social discovery: ${stored.length} profile(s) stored ` +
        `(${stored.map((s) => `${s.profile.platform}:${s.profile.status}`).join(', ') || 'none'}).`,
    );
    await ctx.checkpoint();
  }

  // ─── SERP fallback ──────────────────────────────────────────────────────

  private async serpFallback(ctx: DiscoveryRunContext, missing: PresencePlatform[]): Promise<SocialCandidate[]> {
    if (missing.length === 0) {
      await ctx.note('Social discovery: every expected platform already has a same-site profile. Nothing to search for.');
      return [];
    }

    const cap = this.serpQueryCap();
    const spent = ctx.state.search?.queriesRun ?? 0;
    if (spent >= cap) {
      await ctx.note(
        `Social discovery: SERP fallback skipped. The run has already spent its ${cap}-query ceiling ` +
          `(${missing.length} platform(s) left unchecked: ${missing.map(label).join(', ')}).`,
      );
      return [];
    }

    // Only platforms not already swept, so a re-enqueued job continues the
    // sweep instead of paying for the same searches again.
    const alreadySwept = new Set(ctx.state.search?.fieldsSearched ?? []);
    const toSweep = missing.filter((p) => !alreadySwept.has(p));
    if (toSweep.length === 0) {
      await ctx.note(
        `Social discovery: ${missing.length} expected platform(s) still missing, but they were already swept this run.`,
      );
      return [];
    }

    const sweep = await this.presenceSerp.sweep(ctx.project.name, ctx.project.domain, toSweep);

    // Recorded even when the sweep was skipped or found nothing — the point is
    // that these platforms have been looked at, so a re-enqueue does not look again.
    ctx.state.search = {
      queriesRun: spent + sweep.queriesSpent,
      costUsd: (ctx.state.search?.costUsd ?? 0) + sweep.costUsd,
      fieldsSearched: [...(ctx.state.search?.fieldsSearched ?? []), ...toSweep],
    };

    if (sweep.skipped) {
      await ctx.note(
        `Social discovery: SERP fallback did not run for ${toSweep.map(label).join(', ')}; ${sweep.skipped}. ` +
          `These platforms stay unknown rather than assumed absent.`,
      );
    } else {
      await ctx.note(
        `Social discovery: SERP fallback searched ${toSweep.map(label).join(', ')}; ` +
          `${sweep.queriesSpent} search(es), $${sweep.costUsd.toFixed(4)}, ` +
          `${sweep.candidates.length} candidate(s) found. Candidates are verified below, never trusted as-is.`,
      );
    }

    return sweep.candidates.map((c) => ({
      platform: c.platform,
      url: c.url,
      handle: c.handle,
      entity: c.entity,
      discoveryMethod: 'serp' as const,
      nameSimilarity: c.confidence,
      title: c.title,
    }));
  }

  private serpQueryCap(): number {
    return Number(this.config.get<string>('PRESENCE_SERP_MAX_QUERIES', String(SERP_QUERY_CAP_DEFAULT)));
  }

  // ─── Persistence ────────────────────────────────────────────────────────

  /**
   * Store one scored profile. Idempotent by (project, platform, url) so
   * re-running this stage after a pause updates the same row rather than
   * accumulating duplicates.
   */
  private async upsertProfile(ctx: DiscoveryRunContext, profile: ScoredSocialProfile): Promise<void> {
    const existing = await this.prisma.socialProfile.findFirst({
      where: { projectId: ctx.project.id, platform: profile.platform, url: profile.url },
    });

    const data = {
      platform: profile.platform,
      url: profile.url,
      discoveryMethod: SOCIAL_METHOD_TO_PRISMA[profile.discoveryMethod],
      score: profile.score,
      verificationStatus: SOCIAL_STATUS_TO_PRISMA[profile.status],
      verifiedAt: profile.status === 'verified' ? new Date() : null,
    };

    if (existing) {
      await this.prisma.socialProfile.update({ where: { id: existing.id }, data });
      return;
    }
    await this.prisma.socialProfile.create({ data: { projectId: ctx.project.id, ...data } });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** The platform set this business is expected to have, per its inferred profile. */
function expectedPlatformsFor(category: string | null): PresencePlatform[] {
  const profile = inferBusinessProfile(category);
  const list = EXPECTED_BY_PROFILE[profile] ?? EXPECTED_PLATFORMS;
  return [...list];
}

/**
 * A crawled account as a scoring candidate. The discovery service reports its
 * provenance as a `PresenceSource`; only the JSON-LD declaration is a distinct
 * discovery method here, because that is the one the schema records separately
 * (`SAMEAS` vs `LINK_SCAN`). `manual` cannot occur — nothing in this pipeline
 * enters accounts by hand.
 */
function accountToCandidate(account: DiscoveredAccount): SocialCandidate {
  return {
    platform: account.platform,
    url: account.url,
    handle: account.handle,
    entity: account.entity,
    discoveryMethod: account.source === 'json-ld-sameas' ? 'same-as' : 'link-scan',
  };
}

/**
 * Whose profile a scored row was — needed after scoring, because the entity
 * only travels on the candidate, not on the result.
 */
function candidateEntity(
  found: DiscoveredAccount[],
  serp: SocialCandidate[],
  url: string,
): string {
  return found.find((a) => a.url === url)?.entity ?? serp.find((c) => c.url === url)?.entity ?? 'unknown';
}

function label(platform: PresencePlatform): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

/**
 * The highest-confidence validated value for a field, or null. Consolidation
 * has not run yet at this point in the pipeline, so the reconciled fact list in
 * the run's state is the only source — and only facts that passed validate are
 * worth reading identity from.
 */
function singleFactValue(ctx: DiscoveryRunContext, field: string): string | null {
  const facts: ReconciledFact[] = (ctx.state.facts ?? []).filter(
    (f) => f.field === field && f.validated !== false && f.sourceType !== 'external',
  );
  if (facts.length === 0) return null;
  return [...facts].sort((a, b) => b.confidence - a.confidence)[0]!.value;
}
