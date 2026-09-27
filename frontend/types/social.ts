/**
 * Social performance tab types — a thin mirror of the backend's public
 * social-activity run shape (`social-activity.types.ts` + the
 * `social_activity_runs` row). The tab reads everything; nothing here writes.
 *
 * The list fetcher (`listSocialActivityRuns` in `@/lib/dashboard-api.ts`)
 * already covers the reads, so this module carries types only.
 */

export type SocialRunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'FAILED';

export type ActivityPattern = 'daily' | 'every-2-3-days' | 'weekly' | 'sporadic' | 'dormant';

export interface SocialPlatformActivity {
  platform: string;
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
  windowTruncated: boolean;
}

export interface SocialActivityFinding {
  type: string;
  platform: string;
  status: 'pass' | 'fail' | 'error' | 'not-run';
  severity: 'info' | 'warn';
  detail: string;
}

export type SocialDeltaMetric = 'followers' | 'postsInWindow' | 'pattern' | 'daysSinceLastPost';

export interface SocialActivityDelta {
  platform: string;
  metric: SocialDeltaMetric;
  previous: number | string | null;
  current: number | string | null;
}

export interface SocialActivityRun {
  id: string;
  projectId: string;
  status: SocialRunStatus;
  platforms: string[];
  result: { platforms?: SocialPlatformActivity[]; ceilingHit?: boolean } & Record<string, unknown>;
  findings: SocialActivityFinding[];
  deltas: SocialActivityDelta[];
  narrative: string | null;
  totalCostUsd: number | null;
  previousRunId: string | null;
  createdAt: string;
  completedAt: string | null;
}

export function socialRunPlatforms(run: SocialActivityRun): SocialPlatformActivity[] {
  const result = run.result as { platforms?: unknown };
  if (!result || !Array.isArray(result.platforms)) return [];
  return result.platforms as SocialPlatformActivity[];
}

export const PATTERN_LABEL: Record<ActivityPattern, string> = {
  daily: 'Daily',
  'every-2-3-days': 'Every 2–3 days',
  weekly: 'Weekly',
  sporadic: 'Sporadic',
  dormant: 'Dormant',
};

export const PATTERN_ORDER: ActivityPattern[] = ['daily', 'every-2-3-days', 'weekly', 'sporadic', 'dormant'];
