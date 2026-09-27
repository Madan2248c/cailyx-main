/**
 * Test fixture — one realistic snapshot every remediation spec starts from,
 * overridable per test. Not a spec file itself (vitest only runs *.spec.ts).
 *
 * @module remediation/testing/snapshot.fixture
 */

import type { AuditFinding } from '../../technical-audit/technical-audit.types.js';
import type { SnapshotPage, SourceSnapshot } from '../remediation.types.js';

export const SITE = 'https://acme.test';
export const TA_RUN = '11111111-1111-1111-1111-111111111111';
export const SA_RUN = '22222222-2222-2222-2222-222222222222';
export const AEO_RUN = '33333333-3333-3333-3333-333333333333';

export const ROBOTS_BLOCKING = [
  'User-agent: *',
  'Disallow: /admin',
  '',
  'User-agent: OAI-SearchBot',
  'User-agent: PerplexityBot',
  'Disallow: /',
  '',
  'User-agent: GPTBot',
  'Disallow: /',
].join('\n');

export function finding(type: AuditFinding['type'], status: AuditFinding['status'], detail: Record<string, unknown>, severity: AuditFinding['severity'] = 'medium'): AuditFinding {
  return { type, status, severity, confidence: 'confirmed', recommendedFix: `fix ${type}`, detail };
}

export function page(url: string, issues: SnapshotPage['issues'], score = 50, signals: SnapshotPage['signals'] = {}): SnapshotPage {
  return { url, statusCode: 200, score, issues, signals: { title: 'Acme page', ...signals } };
}

export function snapshot(overrides: Partial<SourceSnapshot> = {}): SourceSnapshot {
  return {
    clientId: 'client-1',
    projectId: 'project-1',
    projectName: 'Acme',
    siteUrl: SITE,
    technicalAudit: {
      runId: TA_RUN,
      completedAt: new Date('2026-09-20T10:00:00Z'),
      findings: [
        finding('robots', 'fail', {
          robotsUrl: `${SITE}/robots.txt`,
          robotsTxtFound: true,
          blockedSearch: ['OAI-SearchBot', 'PerplexityBot'],
          blockedLiveFetch: [],
          blockedTraining: ['GPTBot'],
          rawContent: ROBOTS_BLOCKING,
        }, 'high'),
        finding('schema', 'fail', { schemasFound: false, hasOrganization: false, missingFields: [], schemaTypes: [] }),
        finding('sitemap', 'pass', { found: true, sitemapUrl: `${SITE}/sitemap.xml`, declaredInRobots: false, staleDays: 3 }),
        finding('page-inventory', 'fail', {}),
        finding('cwv', 'pass', {}),
      ],
      pages: [
        page(`${SITE}/pricing`, ['meta-missing', 'canonical-missing', 'thin-content'], 40, { title: 'Pricing' }),
        page(`${SITE}/about`, ['title-too-long', 'thin-content'], 60),
        page(`${SITE}/`, [], 95, { title: 'Acme — widgets for teams', metaDescription: 'Acme makes widgets.' }),
      ],
    },
    socialActivity: {
      runId: SA_RUN,
      completedAt: new Date('2026-09-21T10:00:00Z'),
      findings: [
        { type: 'dormant-platform', platform: 'linkedin', status: 'fail', severity: 'warn', detail: 'No posts in the window on linkedin.' },
        { type: 'active-platform', platform: 'x', status: 'pass', severity: 'info', detail: 'x: regular, 8 posts in window.' },
      ],
    },
    aeoAudit: {
      runId: AEO_RUN,
      completedAt: new Date('2026-09-22T10:00:00Z'),
      headlines: ['Mentioned in 2 of 10 answers.'],
      losingPrompts: [{ observationId: '44444444-4444-4444-4444-444444444444', prompt: 'Best widget tool for small teams', losesTo: ['Globex'] }],
      winningPrompts: [],
    },
    company: {
      name: 'Acme',
      url: SITE,
      description: 'Acme makes widgets for small teams.',
      logoUrl: null,
      sameAs: ['https://www.linkedin.com/company/acme'],
      offerings: ['Widget Cloud'],
    },
    gapAnalysis: {
      runId: '55555555-5555-5555-5555-555555555555',
      recommendations: [{ id: 'rec-1', sourceFindings: [{ module: 'technical-audit', findingRef: 'robots' }] }],
    },
    ...overrides,
  };
}
