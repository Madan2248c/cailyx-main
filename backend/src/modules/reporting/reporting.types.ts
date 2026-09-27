/**
 * Reporting vocabulary — the assembled, source-agnostic content model one
 * report's HTML renders from. Every top-level section is present or
 * `null` — a missing source is omitted, never fabricated, same discipline
 * as Gap Analysis.
 *
 * @module reporting/reporting.types
 */

export type ReportKind = 'DAY1' | 'MONTHLY';

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

/** One metric's run-over-run movement — MONTHLY only, pure subtraction of already-computed numbers, never judged. */
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
  /** LLM-written, cited-numbers-only. */
  executiveSummary: string;
  /** Section keys in display order — DAY1: worst-finding-first; MONTHLY: deltas lead. */
  sectionOrder: string[];
  technicalAudit: TechnicalAuditSection | null;
  socialActivity: SocialActivitySection | null;
  aeoAudit: AeoAuditSection | null;
  competitors: CompetitorsSection | null;
  gapAnalysis: GapAnalysisSection | null;
  /** MONTHLY only, `null` for DAY1 or a project's first MONTHLY (no baseline). */
  deltas: ReportDelta[] | null;
}
