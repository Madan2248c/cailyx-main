/**
 * Social Activity module vocabulary — what a company's publishing activity
 * looks like, as data.
 *
 * Ported shape, new-repo schema: the old repo's `digital-presence`
 * `SocialPostDto` / `SocialActivitySummary` / run DTOs were that module's
 * own reporting surface. The platform union here intentionally matches the
 * social group of `discovery/services/presence.types.ts`
 * (`PLATFORM_GROUP[platform] === 'social'`); the three-state honesty rule
 * (refused reads are `unverified`, never `missing`) applies unchanged.
 *
 * @module social-activity/social-activity.types
 */

/** Platforms v1 pulls. YouTube/TikTok are specified but off by default. */
export type SocialActivityPlatform = 'linkedin' | 'instagram' | 'facebook' | 'x' | 'youtube' | 'tiktok';

export const ALL_SOCIAL_PLATFORMS: readonly SocialActivityPlatform[] = [
  'linkedin',
  'instagram',
  'facebook',
  'x',
  'youtube',
  'tiktok',
];

/** v1 default set — the old D7 table. YouTube/TikTok join when requested/configured. */
export const DEFAULT_SOCIAL_PLATFORMS: readonly SocialActivityPlatform[] = [
  'linkedin',
  'instagram',
  'facebook',
  'x',
];

/** One pull target: the verified account's own URL/handle, when on file. */
export interface SocialActivityTarget {
  platform: SocialActivityPlatform;
  url: string | null;
  handle: string | null;
}

/** Cadence pattern bucket — thresholds live in `social-activity.constants.ts`. */
export type ActivityPattern = 'daily' | 'every-2-3-days' | 'weekly' | 'sporadic' | 'dormant';

/** Per-platform aggregates over the 30-day window. Pure-function output. */
export interface PlatformActivity {
  platform: SocialActivityPlatform;
  followerCount: number | null;
  postsSampled: number;
  postsInWindow: number;
  undatedPosts: number;
  lastPostAt: string | null;
  meanIntervalDays: number | null;
  longestGapDays: number | null;
  daysSinceLastPost: number | null;
  avgEngagement: number | null;
  pattern: ActivityPattern;
  /** True when the pull hit the per-platform cap — longest gap is a lower bound. */
  windowTruncated: boolean;
}

/** One platform finding — audit, not advice. No recommendations v1. */
export interface SocialActivityFinding {
  type: string;
  platform: SocialActivityPlatform;
  status: 'pass' | 'fail' | 'error' | 'not-run';
  severity: 'info' | 'warn';
  detail: string;
}

/** Run-over-run movement on the stored aggregates. Aggregates only. */
export interface SocialActivityDelta {
  platform: SocialActivityPlatform;
  metric: 'followers' | 'postsInWindow' | 'pattern' | 'daysSinceLastPost';
  previous: number | string | null;
  current: number | string | null;
}
