/**
 * Pure aggregation over stored social rows — no I/O, no Apify calls.
 * Ports the old `summarizeSocialActivity` math and extends it with the
 * 30-day window aggregates + pattern buckets approved in
 * docs/analysis/digital-presence-audit.md. Testable in isolation.
 *
 * @module social-activity/services/social-activity.aggregation
 */

import { DORMANT_AFTER_DAYS, PATTERN_THRESHOLDS, SPORADIC_FLAG_AFTER_DAYS } from '../social-activity.constants.js';
import type {
  ActivityPattern,
  PlatformActivity,
  SocialActivityDelta,
  SocialActivityFinding,
  SocialActivityPlatform,
} from '../social-activity.types.js';

/** One stored row, shaped from `social_posts` (or a fixture with the same fields). */
export interface StoredSocialRow {
  platform: string;
  kind: 'profile' | 'post';
  postedAt: string | Date | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  followerCount: number | null;
}

const DAY_MS = 86_400_000;

/**
 * Aggregate one platform's rows: follower snapshot, windowed cadence,
 * engagement mean, pattern bucket. `now` injectable for tests.
 */
export function aggregatePlatform(
  platform: SocialActivityPlatform,
  rows: StoredSocialRow[],
  windowDays: number,
  postsPerPlatform: number,
  now: Date = new Date(),
): PlatformActivity {
  const profileRow = rows.find((r) => r.kind === 'profile' && r.followerCount != null);
  const postRows = rows.filter((r) => r.kind === 'post');
  const postsSampled = postRows.length;

  const windowStart = now.getTime() - windowDays * DAY_MS;
  const dated = postRows
    .map((r) => ({ row: r, time: toTime(r.postedAt) }))
    .filter((d): d is { row: StoredSocialRow; time: number } => d.time != null)
    .sort((a, b) => b.time - a.time);
  const undatedPosts = postsSampled - dated.length;

  const inWindow = dated.filter((d) => d.time >= windowStart);
  const postsInWindow = inWindow.length;

  const lastPostAt = dated.length > 0 ? new Date(dated[0]!.time).toISOString() : null;
  const daysSinceLastPost =
    dated.length > 0 ? Math.max(0, (now.getTime() - dated[0]!.time) / DAY_MS) : null;

  let meanIntervalDays: number | null = null;
  let longestGapDays: number | null = null;
  if (inWindow.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < inWindow.length; i++) {
      gaps.push((inWindow[i - 1]!.time - inWindow[i]!.time) / DAY_MS);
    }
    meanIntervalDays = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    longestGapDays = Math.max(...gaps);
  }

  const engagements = postRows.map(
    (r) => (r.likeCount ?? 0) + (r.commentCount ?? 0) + (r.shareCount ?? 0),
  );
  const avgEngagement = engagements.length > 0 ? engagements.reduce((s, e) => s + e, 0) / engagements.length : null;

  const pattern = bucketPattern(postsInWindow, meanIntervalDays, daysSinceLastPost);

  return {
    platform,
    followerCount: profileRow?.followerCount ?? null,
    postsSampled,
    postsInWindow,
    undatedPosts,
    lastPostAt,
    meanIntervalDays,
    longestGapDays,
    daysSinceLastPost,
    avgEngagement,
    pattern,
    // Hit the pull cap: the sample may cover days, not the window — the
    // mean stays valid but the longest gap is a lower bound.
    windowTruncated: postsSampled >= postsPerPlatform,
  };
}

/** Pattern bucket from the approved thresholds. Dormant is absolute, not relative. */
export function bucketPattern(
  postsInWindow: number,
  meanIntervalDays: number | null,
  daysSinceLastPost: number | null,
): ActivityPattern {
  if (postsInWindow === 0) return 'dormant';
  if (daysSinceLastPost != null && daysSinceLastPost > DORMANT_AFTER_DAYS) return 'dormant';
  if (meanIntervalDays == null) return 'sporadic'; // single dated post in window
  if (meanIntervalDays <= PATTERN_THRESHOLDS.DAILY_MAX) return 'daily';
  if (meanIntervalDays <= PATTERN_THRESHOLDS.FREQUENT_MAX) return 'every-2-3-days';
  if (meanIntervalDays <= PATTERN_THRESHOLDS.WEEKLY_MAX) return 'weekly';
  return 'sporadic';
}

/**
 * Findings v1 — audit, not advice. `dormant` and quiet-`sporadic` platforms
 * flag; undated-only platforms are data-quality flags, never cadence claims.
 */
export function findingsFor(activity: PlatformActivity): SocialActivityFinding[] {
  const out: SocialActivityFinding[] = [];
  if (activity.pattern === 'dormant') {
    out.push({
      type: 'dormant-platform',
      platform: activity.platform,
      status: 'fail',
      severity: 'warn',
      detail:
        activity.postsInWindow === 0
          ? `No posts in the window on ${activity.platform}.`
          : `Last post ${(activity.daysSinceLastPost ?? 0).toFixed(0)} days ago on ${activity.platform}.`,
    });
    return out;
  }
  if (
    activity.pattern === 'sporadic' &&
    activity.daysSinceLastPost != null &&
    activity.daysSinceLastPost > SPORADIC_FLAG_AFTER_DAYS
  ) {
    out.push({
      type: 'infrequent-platform',
      platform: activity.platform,
      status: 'fail',
      severity: 'warn',
      detail: `Sporadic posting on ${activity.platform}; last post ${(activity.daysSinceLastPost).toFixed(0)} days ago.`,
    });
  }
  if (activity.postsSampled > 0 && activity.postsInWindow === 0 && activity.undatedPosts > 0) {
    out.push({
      type: 'undated-platform',
      platform: activity.platform,
      status: 'not-run',
      severity: 'info',
      detail: `${activity.platform} returned posts without usable dates, so posting rhythm could not be confirmed.`,
    });
  }
  if (out.length === 0) {
    out.push({
      type: 'active-platform',
      platform: activity.platform,
      status: 'pass',
      severity: 'info',
      detail: `${activity.platform}: ${activity.pattern}, ${activity.postsInWindow} posts in window.`,
    });
  }
  return out;
}

/** Run-over-run movement on the stored aggregates. Aggregates only, no post churn. */
export function deltasFor(previous: PlatformActivity[], current: PlatformActivity[]): SocialActivityDelta[] {
  const prev = new Map(previous.map((p) => [p.platform, p]));
  const out: SocialActivityDelta[] = [];
  for (const cur of current) {
    const p = prev.get(cur.platform);
    if (!p) continue;
    if (p.followerCount !== cur.followerCount) {
      out.push({ platform: cur.platform, metric: 'followers', previous: p.followerCount, current: cur.followerCount });
    }
    if (p.postsInWindow !== cur.postsInWindow) {
      out.push({ platform: cur.platform, metric: 'postsInWindow', previous: p.postsInWindow, current: cur.postsInWindow });
    }
    if (p.pattern !== cur.pattern) {
      out.push({ platform: cur.platform, metric: 'pattern', previous: p.pattern, current: cur.pattern });
    }
    if (p.daysSinceLastPost !== cur.daysSinceLastPost) {
      out.push({
        platform: cur.platform,
        metric: 'daysSinceLastPost',
        previous: p.daysSinceLastPost,
        current: cur.daysSinceLastPost,
      });
    }
  }
  return out;
}

function toTime(value: string | Date | null): number | null {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}
