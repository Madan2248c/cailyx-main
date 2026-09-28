/**
 * Apify social-activity adapter — ported from the old repo's
 * `digital-presence/presence.apify.service.ts` (logic kept; persistence and
 * module wiring rewritten). See docs/analysis/digital-presence-audit.md
 * "Platform / actor table" for the per-platform choices and their status.
 *
 * ## This adapter must never spend money by accident
 *
 * `APIFY_API_KEY` is a REAL key on a REAL account. Every actor run is real
 * spend. Two independent gates:
 *   1. `APIFY_API_KEY` must be configured — fails closed with a typed 503.
 *   2. The caller must pass `confirmSpend: true` — checked in
 *      `SocialActivityService` BEFORE this adapter is touched at all. A
 *      default/automatic run must never reach this file.
 *
 * ## API shape (async lifecycle only)
 *   `POST /v2/actors/{actorId}/runs` (async) → `{ data: { id, status,
 *   defaultDatasetId } }`. Actor ids are `owner/name`; Apify's REST path
 *   wants `owner~name`.
 *   `GET  /v2/actor-runs/{runId}` polled until a terminal status
 *   (`SUCCEEDED` | `FAILED` | `ABORTED` | `TIMED-OUT`).
 *   `GET  /v2/datasets/{id}/items` → the raw item array; schema is
 *   actor-specific and normalised in `normalizeItem`.
 * The 300s sync run-and-get-items variant is too short for anything real
 * and is never used.
 *
 * ## What is NOT verified
 * Per-actor input schemas are best-effort against each actor's public Store
 * listing, kept to one small function per actor so a confirming live run
 * corrects exactly one place. `normalizeItem` tries several candidate field
 * names per metric; an absent one is `null`, never guessed.
 *
 * @module social-activity/services/apify.service
 */

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APIFY_POLL_INTERVAL_MS, APIFY_POLL_TIMEOUT_MS } from '../social-activity.constants.js';
import type { SocialActivityPlatform, SocialActivityTarget } from '../social-activity.types.js';
import { ALL_SOCIAL_PLATFORMS, DEFAULT_SOCIAL_PLATFORMS } from '../social-activity.types.js';

const APIFY_BASE_URL = 'https://api.apify.com/v2';

type ActorRole = 'profile' | 'posts';

/**
 * platform:role -> actorId. Defaults mirror the old D7 table (reliability
 * then price). Overridable via `APIFY_ACTORS` JSON — same escape hatch.
 *
 * `linkedin:posts` is deliberately the COMPANY actor: the sibling
 * person-profile actor takes `profileUrls` for a PERSON and silently
 * returns zero posts against a company page (no error — just nothing).
 */
const DEFAULT_ACTORS: Record<string, string> = {
  'linkedin:profile': 'harvestapi/linkedin-company',
  'linkedin:posts': 'harvestapi/linkedin-company-posts',
  'instagram:profile': 'apify/instagram-profile-scraper',
  'instagram:posts': 'apify/instagram-post-scraper',
  'facebook:profile': 'apify/facebook-pages-scraper',
  'facebook:posts': 'apify/facebook-posts-scraper',
  // X/Twitter has one actor covering posts only — no separate profile actor.
  'x:posts': 'xquik/x-tweet-scraper',
  'youtube:profile': 'streamers/youtube-channel-scraper',
  'tiktok:profile': 'clockworks/tiktok-profile-scraper',
};

/** Per-unit prices from the old cost table, USD. Estimate only — never the billed figure. */
const ACTOR_UNIT_COST_USD: Record<string, number> = {
  'harvestapi/linkedin-company': 0.004,
  'harvestapi/linkedin-company-posts': 0.002,
  'apify/instagram-profile-scraper': 0.0026,
  'apify/instagram-post-scraper': 0.0017,
  'apify/facebook-pages-scraper': 0.012,
  'apify/facebook-posts-scraper': 0.005,
  'xquik/x-tweet-scraper': 0.00015,
  'streamers/youtube-channel-scraper': 0.0013,
  'clockworks/tiktok-profile-scraper': 0.003,
};

/** One normalised row, ready for `social_posts`. */
export interface NormalizedSocialItem {
  platform: SocialActivityPlatform;
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
}

export interface ApifyRoleResult {
  platform: SocialActivityPlatform;
  role: ActorRole;
  actorId: string;
  items: NormalizedSocialItem[];
  costUsd: number;
  error: string | null;
}

export interface ApifyRunResult {
  results: ApifyRoleResult[];
  skipped: Array<{ platform: SocialActivityPlatform; reason: string }>;
  totalCostUsd: number;
}

interface ApifyRunSummary {
  id: string;
  status: string;
  defaultDatasetId: string;
  usageTotalUsd?: number;
}

@Injectable()
export class ApifyService {
  private readonly logger = new Logger(ApifyService.name);

  constructor(private readonly config: ConfigService) {}

  /** True only when the key is configured. Callers report the absence, never guess. */
  get enabled(): boolean {
    return !!this.config.get<string>('APIFY_API_KEY');
  }

  /** The platform set to use when a request does not name its own. */
  defaultPlatforms(): SocialActivityPlatform[] {
    const raw = this.config.get<string>('APIFY_PLATFORMS');
    if (!raw) return [...DEFAULT_SOCIAL_PLATFORMS];
    const parsed = raw
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter((p): p is SocialActivityPlatform => (ALL_SOCIAL_PLATFORMS as readonly string[]).includes(p));
    return parsed.length > 0 ? parsed : [...DEFAULT_SOCIAL_PLATFORMS];
  }

  /**
   * Run the configured actors for each target platform and return normalised
   * rows. Callers are responsible for the `confirmSpend` opt-in gate — by the
   * time this method is called, the decision to spend is already explicit.
   *
   * @throws ServiceUnavailableException when `APIFY_API_KEY` is not configured.
   */
  async run(targets: SocialActivityTarget[], postsPerPlatform: number): Promise<ApifyRunResult> {
    // Fail closed BEFORE touching the network.
    const key = this.assertConfigured();
    const actors = this.resolveActorMap();

    const results: ApifyRoleResult[] = [];
    const skipped: ApifyRunResult['skipped'] = [];

    for (const target of targets) {
      if (!target.url && !target.handle) {
        skipped.push({ platform: target.platform, reason: 'no linked account on file for this platform' });
        continue;
      }

      const roles: ActorRole[] = target.platform === 'x' ? ['posts'] : ['profile', 'posts'];
      for (const role of roles) {
        const actorId = actors[`${target.platform}:${role}`];
        if (!actorId) continue; // not every platform has both roles (x has no profile actor)

        try {
          const input = buildInput(target.platform, role, target, postsPerPlatform);
          const summary = await this.runActor(key, actorId, input);
          const rawItems = await this.getDatasetItems(key, summary.defaultDatasetId);
          const items = rawItems.map((raw) => normalizeItem(target.platform, role, actorId, raw));
          const costUsd = summary.usageTotalUsd ?? estimateCost(actorId, items.length);
          results.push({ platform: target.platform, role, actorId, items, costUsd, error: null });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Apify ${target.platform}:${role} (${actorId}) failed: ${message}`);
          results.push({ platform: target.platform, role, actorId, items: [], costUsd: 0, error: message });
        }
      }
    }

    const totalCostUsd = results.reduce((sum, r) => sum + r.costUsd, 0);
    return { results, skipped, totalCostUsd };
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private assertConfigured(): string {
    const key = this.config.get<string>('APIFY_API_KEY');
    if (!key) {
      throw new ServiceUnavailableException(
        'APIFY_API_KEY is not set. Add it to run social-activity pulls (see docs/analysis/digital-presence-audit.md).',
      );
    }
    return key;
  }

  private resolveActorMap(): Record<string, string> {
    const raw = this.config.get<string>('APIFY_ACTORS');
    if (!raw) return DEFAULT_ACTORS;
    try {
      const overrides = JSON.parse(raw) as Record<string, string>;
      return { ...DEFAULT_ACTORS, ...overrides };
    } catch {
      this.logger.warn('APIFY_ACTORS is not valid JSON. Ignoring it and using the built-in actor map.');
      return DEFAULT_ACTORS;
    }
  }

  private headers(key: string): Record<string, string> {
    return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  }

  /** `POST /v2/actors/{actorId}/runs` then poll `/v2/actor-runs/{id}` to a terminal status. */
  private async runActor(key: string, actorId: string, input: Record<string, unknown>): Promise<ApifyRunSummary> {
    const encoded = encodeActorId(actorId);
    const createRes = await fetch(`${APIFY_BASE_URL}/actors/${encoded}/runs`, {
      method: 'POST',
      headers: this.headers(key),
      body: JSON.stringify(input),
    });
    if (!createRes.ok) {
      const body = await createRes.text();
      throw new Error(`POST /v2/actors/${actorId}/runs returned HTTP ${createRes.status}: ${body.slice(0, 300)}`);
    }
    const created = (await createRes.json()) as { data: ApifyRunSummary };
    const runId = created.data.id;

    const started = Date.now();
    while (Date.now() - started < APIFY_POLL_TIMEOUT_MS) {
      await this.sleep(APIFY_POLL_INTERVAL_MS);
      const pollRes = await fetch(`${APIFY_BASE_URL}/actor-runs/${runId}`, { headers: this.headers(key) });
      if (!pollRes.ok) {
        throw new Error(`GET /v2/actor-runs/${runId} returned HTTP ${pollRes.status}`);
      }
      const polled = (await pollRes.json()) as { data: ApifyRunSummary };
      const status = polled.data.status;
      if (status === 'SUCCEEDED') return polled.data;
      if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
        throw new Error(`Apify run ${runId} ended with status ${status}`);
      }
      // READY | RUNNING — keep polling
    }
    throw new Error(`Apify run ${runId} did not finish within ${APIFY_POLL_TIMEOUT_MS}ms`);
  }

  /** `GET /v2/datasets/{id}/items` — the raw, actor-specific item array. */
  private async getDatasetItems(key: string, datasetId: string): Promise<Record<string, unknown>[]> {
    const res = await fetch(`${APIFY_BASE_URL}/datasets/${datasetId}/items?clean=true`, {
      headers: this.headers(key),
    });
    if (!res.ok) {
      throw new Error(`GET /v2/datasets/${datasetId}/items returned HTTP ${res.status}`);
    }
    const items = (await res.json()) as unknown[];
    return items.filter((i): i is Record<string, unknown> => !!i && typeof i === 'object');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** Apify's REST path wants `owner~name`, not `owner/name`. */
function encodeActorId(actorId: string): string {
  return actorId.replace(/\//g, '~');
}

function estimateCost(actorId: string, itemCount: number): number {
  const unit = ACTOR_UNIT_COST_USD[actorId];
  return unit ? unit * Math.max(itemCount, 1) : 0;
}

/**
 * Best-effort actor input — per-actor schemas are unverified until one
 * operator-authorised live run confirms each. One branch per actor family
 * so a confirming run only ever touches that branch.
 */
export function buildInput(
  platform: SocialActivityPlatform,
  role: ActorRole,
  target: SocialActivityTarget,
  postsPerPlatform: number,
): Record<string, unknown> {
  const handle = target.handle ?? undefined;
  const url = target.url ?? undefined;

  switch (platform) {
    case 'linkedin':
      return role === 'profile'
        ? { companies: [url ?? handle] }
        // harvestapi/linkedin-company-posts's own input schema: `targetUrls`
        // (accepts a company page URL directly) + `maxPosts`.
        : { targetUrls: [url ?? handle], maxPosts: postsPerPlatform };
    case 'instagram':
      return role === 'profile' ? { usernames: [handle ?? url] } : { username: [handle ?? url], resultsLimit: postsPerPlatform };
    case 'facebook':
      return role === 'profile'
        ? { startUrls: [{ url }] }
        : { startUrls: [{ url }], resultsLimit: postsPerPlatform };
    case 'x':
      // xquik/x-tweet-scraper's own input schema: `twitterHandles`, not
      // `handles` — the wrong field name runs with no real target and
      // silently returns zero tweets (no error). `within_time` scopes to
      // recent activity rather than the full archive.
      return { twitterHandles: [handle], maxItems: postsPerPlatform, within_time: '30d' };
    case 'youtube':
      return { startUrls: [{ url }] };
    case 'tiktok':
      return { profiles: [handle ?? url] };
  }
}

/**
 * Fold one actor's raw dataset item into the shared shape. Several candidate
 * field names are tried per metric; an absent one is `null` — actor output
 * schemas differ wildly and that variance must not leak past this file.
 */
export function normalizeItem(
  platform: SocialActivityPlatform,
  role: ActorRole,
  actorId: string,
  raw: Record<string, unknown>,
): NormalizedSocialItem {
  const kind: 'profile' | 'post' = role === 'profile' ? 'profile' : 'post';
  return {
    platform,
    kind,
    postedAt: pickDate(raw, ['postedAt', 'timestamp', 'time', 'date', 'createdAt', 'publishedAt']),
    url: pickString(raw, ['url', 'postUrl', 'link', 'webVideoUrl']),
    caption: pickString(raw, ['caption', 'text', 'description', 'content']),
    likeCount: pickNumber(raw, ['likeCount', 'likesCount', 'likes', 'favoriteCount', 'diggCount']),
    commentCount: pickNumber(raw, ['commentCount', 'commentsCount', 'comments', 'replyCount']),
    shareCount: pickNumber(raw, ['shareCount', 'sharesCount', 'shares', 'retweetCount', 'repostCount']),
    viewCount: pickNumber(raw, ['viewCount', 'viewsCount', 'views', 'playCount']),
    followerCount: pickNumber(raw, ['followerCount', 'followersCount', 'followers', 'subscriberCount', 'employeeCount']),
    followingCount: pickNumber(raw, ['followingCount', 'followsCount', 'following']),
    postCount: pickNumber(raw, ['postCount', 'postsCount', 'mediaCount', 'videoCount']),
    actorId,
    raw: JSON.stringify(raw),
  };
}

function pickString(item: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

function pickNumber(item: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

function pickDate(item: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === 'string' && v.trim()) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      // Some actors report unix seconds, others milliseconds.
      const ms = v > 1e12 ? v : v * 1000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    // Some actors nest the date as { timestamp, date, postedAgoText }.
    if (v && typeof v === 'object') {
      const nested = pickDate(v as Record<string, unknown>, ['date', 'timestamp']);
      if (nested) return nested;
    }
  }
  return null;
}
