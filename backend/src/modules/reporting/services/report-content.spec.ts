import { describe, expect, it } from 'vitest';
import { buildSectionOrder, computeDeltas, worstFirstOrder, type CollectedSections } from './report-content.js';
import type { ReportContent } from '../reporting.types.js';

const empty: CollectedSections = { technicalAudit: null, socialActivity: null, aeoAudit: null, competitors: null, gapAnalysis: null };

describe('worstFirstOrder', () => {
  it('omits sections that were not collected', () => {
    const sections: CollectedSections = { ...empty, technicalAudit: { runId: 't1', score: 80, findings: [], narrative: null } };
    expect(worstFirstOrder(sections)).toEqual(['technicalAudit']);
  });

  it('ranks the lower technical-audit score first', () => {
    const sections: CollectedSections = {
      ...empty,
      technicalAudit: { runId: 't1', score: 40, findings: [], narrative: null },
      aeoAudit: { auditId: 'a1', overallMentionRate: 0.9, overallCitationRate: 0.9, headlines: [], competitorStanding: [] },
    };
    // technicalAudit badness = 100-40 = 60; aeoAudit badness = (1-0.9)*100 = 10
    expect(worstFirstOrder(sections)).toEqual(['technicalAudit', 'aeoAudit']);
  });

  it('breaks a real badness tie by the fixed default order', () => {
    const sections: CollectedSections = {
      ...empty,
      technicalAudit: { runId: 't1', score: 100, findings: [], narrative: null },
      socialActivity: { runId: 's1', platforms: [], findings: [] },
    };
    // both badness 0 (perfect score, no failing findings) — DEFAULT_SECTION_ORDER breaks the tie
    const order = worstFirstOrder(sections);
    expect(order).toEqual(['technicalAudit', 'socialActivity']);
  });

  it('gapAnalysis never leads on its own — present but lowest non-negative badness', () => {
    const sections: CollectedSections = { ...empty, gapAnalysis: { runId: 'g1', recommendations: [] } };
    expect(worstFirstOrder(sections)).toEqual(['gapAnalysis']);
  });
});

describe('computeDeltas', () => {
  const baseContent: ReportContent = {
    meta: { projectName: 'Acme', domain: 'acme.com', kind: 'MONTHLY', generatedAt: '2026-08-01T00:00:00.000Z' },
    executiveSummary: 'prior summary',
    sectionOrder: [],
    technicalAudit: { runId: 't-old', score: 60, findings: [], narrative: null },
    socialActivity: { runId: 's-old', platforms: [{ platform: 'instagram', pattern: 'p', postsInWindow: 4, followerCount: null, avgEngagement: null }], findings: [] },
    aeoAudit: { auditId: 'a-old', overallMentionRate: 0.5, overallCitationRate: 0.3, headlines: [], competitorStanding: [] },
    competitors: null,
    gapAnalysis: null,
    deltas: null,
  };

  it('only diffs technical-audit score, summed social posts, and aeo rates', () => {
    const current: CollectedSections = {
      technicalAudit: { runId: 't-new', score: 75, findings: [], narrative: null },
      socialActivity: { runId: 's-new', platforms: [{ platform: 'instagram', pattern: 'p', postsInWindow: 7, followerCount: null, avgEngagement: null }], findings: [] },
      aeoAudit: { auditId: 'a-new', overallMentionRate: 0.6, overallCitationRate: 0.4, headlines: [], competitorStanding: [] },
      competitors: null,
      gapAnalysis: null,
    };

    const deltas = computeDeltas(baseContent, current);

    expect(deltas).toEqual([
      { module: 'technical-audit', metric: 'score', previous: 60, current: 75 },
      { module: 'social-activity', metric: 'totalPostsInWindow', previous: 4, current: 7 },
      { module: 'aeo-audit', metric: 'overallMentionRate', previous: 0.5, current: 0.6 },
      { module: 'aeo-audit', metric: 'overallCitationRate', previous: 0.3, current: 0.4 },
    ]);
  });

  it('skips a module missing from either side — never diffs against a fabricated baseline', () => {
    const current: CollectedSections = { ...empty, technicalAudit: { runId: 't-new', score: 75, findings: [], narrative: null } };
    const previousWithoutTa: ReportContent = { ...baseContent, technicalAudit: null };
    expect(computeDeltas(previousWithoutTa, current)).toEqual([]);
  });
});

describe('buildSectionOrder', () => {
  it('MONTHLY with deltas leads with the deltas section', () => {
    const sections: CollectedSections = { ...empty, technicalAudit: { runId: 't1', score: 80, findings: [], narrative: null } };
    expect(buildSectionOrder('MONTHLY', sections, true)).toEqual(['deltas', 'technicalAudit']);
  });

  it('MONTHLY without deltas is just the worst-first order', () => {
    const sections: CollectedSections = { ...empty, technicalAudit: { runId: 't1', score: 80, findings: [], narrative: null } };
    expect(buildSectionOrder('MONTHLY', sections, false)).toEqual(['technicalAudit']);
  });

  it('DAY1 never leads with deltas even if hasDeltas is somehow true', () => {
    const sections: CollectedSections = { ...empty, technicalAudit: { runId: 't1', score: 80, findings: [], narrative: null } };
    expect(buildSectionOrder('DAY1', sections, true)).toEqual(['technicalAudit']);
  });
});
