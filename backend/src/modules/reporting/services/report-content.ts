/**
 * Pure content assembly — no I/O. Builds the section-order (worst-first
 * for DAY1, deltas-lead for MONTHLY) and, for MONTHLY, the run-over-run
 * deltas against a previous report's frozen snapshot. Already-computed
 * numbers being subtracted, never judged — same discipline as AEO Audit's
 * comparability check.
 *
 * @module reporting/services/report-content
 */

import { DEFAULT_SECTION_ORDER } from '../reporting.constants.js';
import type {
  AeoAuditSection,
  CompetitorsSection,
  GapAnalysisSection,
  ReportContent,
  ReportDelta,
  SocialActivitySection,
  TechnicalAuditSection,
} from '../reporting.types.js';

export interface CollectedSections {
  technicalAudit: TechnicalAuditSection | null;
  socialActivity: SocialActivitySection | null;
  aeoAudit: AeoAuditSection | null;
  competitors: CompetitorsSection | null;
  gapAnalysis: GapAnalysisSection | null;
}

/** Higher = more damning. Only sections that are actually present are ranked. */
function badnessOf(key: string, sections: CollectedSections): number {
  switch (key) {
    case 'technicalAudit': {
      const s = sections.technicalAudit;
      if (!s) return -1;
      const scorePenalty = s.score != null ? 100 - s.score : 0;
      const failPenalty = s.findings.filter((f) => f.status === 'fail' || f.status === 'error').length * 10;
      return scorePenalty + failPenalty;
    }
    case 'socialActivity': {
      const s = sections.socialActivity;
      if (!s) return -1;
      return s.findings.filter((f) => f.status === 'fail').length * 10;
    }
    case 'aeoAudit': {
      const s = sections.aeoAudit;
      if (!s) return -1;
      return (1 - s.overallMentionRate) * 100;
    }
    case 'competitors': {
      const s = sections.competitors;
      if (!s) return -1;
      const ownScore = s.own.seoScore ?? 0;
      return s.rows.filter((r) => r.seoScore != null && r.seoScore > ownScore).length * 10;
    }
    case 'gapAnalysis':
      return sections.gapAnalysis ? 1 : -1; // present but never leads on its own — it's the action plan, not a finding
    default:
      return -1;
  }
}

/** Worst-finding-first, only present sections, ties broken by the fixed default order. */
export function worstFirstOrder(sections: CollectedSections): string[] {
  return DEFAULT_SECTION_ORDER.filter((key) => badnessOf(key, sections) >= 0)
    .map((key, i) => ({ key, badness: badnessOf(key, sections), i }))
    .sort((a, b) => b.badness - a.badness || a.i - b.i)
    .map((x) => x.key);
}

/**
 * A handful of already-computed, comparable numeric metrics, diffed
 * against the previous report's frozen content snapshot. Bounded set —
 * not every field, only what's meaningfully comparable run-over-run.
 */
export function computeDeltas(previous: ReportContent, current: CollectedSections): ReportDelta[] {
  const deltas: ReportDelta[] = [];

  if (previous.technicalAudit && current.technicalAudit) {
    deltas.push({ module: 'technical-audit', metric: 'score', previous: previous.technicalAudit.score, current: current.technicalAudit.score });
  }
  if (previous.socialActivity && current.socialActivity) {
    const sum = (s: SocialActivitySection) => s.platforms.reduce((acc, p) => acc + p.postsInWindow, 0);
    deltas.push({ module: 'social-activity', metric: 'totalPostsInWindow', previous: sum(previous.socialActivity), current: sum(current.socialActivity) });
  }
  if (previous.aeoAudit && current.aeoAudit) {
    deltas.push({ module: 'aeo-audit', metric: 'overallMentionRate', previous: previous.aeoAudit.overallMentionRate, current: current.aeoAudit.overallMentionRate });
    deltas.push({ module: 'aeo-audit', metric: 'overallCitationRate', previous: previous.aeoAudit.overallCitationRate, current: current.aeoAudit.overallCitationRate });
  }

  return deltas;
}

export function buildSectionOrder(kind: 'DAY1' | 'MONTHLY', sections: CollectedSections, hasDeltas: boolean): string[] {
  const order = worstFirstOrder(sections);
  if (kind === 'MONTHLY' && hasDeltas) return ['deltas', ...order];
  return order;
}
