/**
 * Reports tab types — a thin mirror of the backend reporting module's
 * public shapes (reporting.types.ts + the Prisma Report row). The tab
 * reads everything; nothing here writes.
 */

export type ReportKind = 'DAY1' | 'MONTHLY';

export type ReportStatus = 'DRAFT' | 'IN_REVIEW' | 'RELEASED' | 'WITHDRAWN';

export interface ReportListItem {
  id: string;
  projectId: string;
  kind: ReportKind;
  slug: string;
  status: ReportStatus;
  title: string;
  executiveSummary: string;
  previousReportId: string | null;
  createdAt: string;
  releasedAt: string | null;
}

export interface TechnicalAuditSection {
  runId: string;
  score: number | null;
  findings: Array<{ type: string; status: string; severity: string; recommendedFix: string }>;
  narrative: string | null;
}

export interface SocialActivitySection {
  runId: string;
  platforms: Array<{
    platform: string;
    pattern: string;
    postsInWindow: number;
    followerCount: number | null;
    avgEngagement: number | null;
  }>;
  findings: Array<{ type: string; platform: string; status: string; severity: string; detail: string }>;
}

export interface AeoAuditSection {
  auditId: string;
  overallMentionRate: number;
  overallCitationRate: number;
  headlines: string[];
  competitorStanding: Array<{ name: string; timesAhead: number; timesBehind: number; coMentions: number }>;
  narrative?: string[];
}

export interface CompetitorsSection {
  own: { name: string; domain: string | null; seoScore: number | null };
  rows: Array<{
    name: string;
    domain: string | null;
    seoScore: number | null;
    reviewRating: { source: string; rating: number; count: number | null } | null;
    aeoStanding: { timesAhead: number; timesBehind: number; coMentions: number } | null;
  }>;
}

export interface GapAnalysisSection {
  runId: string;
  recommendations: Array<{ rank: number; title: string; description: string; status: string }>;
}

/** One metric's run-over-run movement — MONTHLY only. */
export interface ReportDelta {
  module: 'technical-audit' | 'social-activity' | 'aeo-audit';
  metric: string;
  previous: number | string | null;
  current: number | string | null;
}

export interface ReportContent {
  meta: {
    projectName: string;
    domain: string;
    kind: ReportKind;
    generatedAt: string;
  };
  executiveSummary: string;
  /** Section keys in display order — DAY1: worst-first; MONTHLY: deltas lead. */
  sectionOrder: string[];
  technicalAudit: TechnicalAuditSection | null;
  socialActivity: SocialActivitySection | null;
  aeoAudit: AeoAuditSection | null;
  competitors: CompetitorsSection | null;
  gapAnalysis: GapAnalysisSection | null;
  /** MONTHLY only, `null` for DAY1 or a first MONTHLY with no baseline. */
  deltas: ReportDelta[] | null;
}

export type ReportDetail = ReportListItem & { content: ReportContent };
