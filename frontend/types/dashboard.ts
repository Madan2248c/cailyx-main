/**
 * Dashboard tab types — thin mirrors of the backend's public shapes for the
 * modules the dashboard fans out to. Reads only; nothing here writes.
 */

export type SocialRunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'FAILED';

export type ActivityPattern = 'daily' | 'every-2-3-days' | 'weekly' | 'sporadic' | 'dormant';

export interface SocialPlatformActivity {
  platform: string;
  followerCount: number | null;
  postsSampled: number;
  postsInWindow: number;
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

export interface SocialActivityRun {
  id: string;
  projectId: string;
  status: SocialRunStatus;
  platforms: string[];
  result: { platforms?: SocialPlatformActivity[] } | Record<string, unknown>;
  findings: SocialActivityFinding[];
  narrative: string | null;
  createdAt: string;
  completedAt: string | null;
}

export function socialRunPlatforms(run: SocialActivityRun): SocialPlatformActivity[] {
  const result = run.result as { platforms?: unknown };
  if (!result || !Array.isArray(result.platforms)) return [];
  return result.platforms as SocialPlatformActivity[];
}

export interface CompetitorGapStanding {
  name: string;
  timesAhead: number;
  timesBehind: number;
  coMentions: number;
}

export interface CompetitorGapRow {
  competitorId: string | null;
  name: string;
  domain: string | null;
  profile: {
    seoScore: number | null;
    fetchStatus: string;
  } | null;
  aeoStanding: CompetitorGapStanding | null;
}

export interface CompetitorGap {
  own: CompetitorGapRow;
  competitors: CompetitorGapRow[];
}

export type GapRunStatus = 'RUNNING' | 'COMPLETE' | 'FAILED';

export type RecommendationStatus = 'OPEN' | 'DONE' | 'DISMISSED';

export interface GapRecommendation {
  id: string;
  title: string;
  description: string;
  priorityRank: number;
  status: RecommendationStatus;
}

export interface GapAnalysisRun {
  id: string;
  projectId: string;
  status: GapRunStatus;
  createdAt: string;
  completedAt: string | null;
  recommendations?: GapRecommendation[];
}

export type ReportKind = 'DAY1' | 'MONTHLY';

export type ReportStatus = 'DRAFT' | 'IN_REVIEW' | 'RELEASED' | 'WITHDRAWN';

export interface ProjectReport {
  id: string;
  projectId: string;
  kind: ReportKind;
  slug: string;
  status: ReportStatus;
  title: string;
  executiveSummary: string;
  createdAt: string;
  releasedAt: string | null;
}
