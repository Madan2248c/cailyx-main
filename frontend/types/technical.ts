/**
 * Technical audit tab types — a thin mirror of the backend's public run
 * shape. The tab reads everything; nothing here writes.
 */

export type AuditCheckType =
  | 'robots'
  | 'cdn-inferred'
  | 'js-render'
  | 'cwv'
  | 'schema'
  | 'sitemap'
  | 'agent-readiness'
  | 'page-inventory';

export type AuditStatus = 'pass' | 'fail' | 'error' | 'not-run';

export interface AuditFinding {
  type: AuditCheckType;
  status: AuditStatus;
  severity: 'low' | 'medium' | 'high';
  confidence: 'confirmed' | 'inferred';
  recommendedFix: string;
  detail?: Record<string, unknown>;
}

export type DeltaDirection = 'improved' | 'regressed' | 'unchanged' | 'new';

export interface AuditDelta {
  metric: string;
  label: string;
  previous: number | null;
  current: number | null;
  change: number | null;
  direction: DeltaDirection;
  higherIsBetter: boolean;
}

export interface TechnicalAuditRun {
  id: string;
  projectId: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  score: number | null;
  findings: AuditFinding[];
  deltas: AuditDelta[];
  narrative: string | null;
  previousAuditId: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface TrendPoint {
  auditId: string;
  at: string;
  score: number | null;
  failures: number;
}

export const CHECK_LABEL: Record<AuditCheckType, string> = {
  robots: 'Robots.txt',
  'cdn-inferred': 'CDN / bot protection',
  'js-render': 'JavaScript rendering',
  cwv: 'Core Web Vitals',
  schema: 'Structured data',
  sitemap: 'Sitemap',
  'agent-readiness': 'AI agent readiness',
  'page-inventory': 'Page inventory',
};

export const CHECK_ORDER: AuditCheckType[] = [
  'robots',
  'cdn-inferred',
  'sitemap',
  'js-render',
  'cwv',
  'schema',
  'agent-readiness',
  'page-inventory',
];

export type PageIssueCode =
  | 'page-error'
  | 'title-missing'
  | 'title-too-short'
  | 'title-too-long'
  | 'meta-missing'
  | 'meta-too-short'
  | 'meta-too-long'
  | 'h1-missing'
  | 'h1-multiple'
  | 'canonical-missing'
  | 'canonical-malformed'
  | 'canonical-cross-domain'
  | 'json-ld-missing'
  | 'json-ld-invalid'
  | 'thin-content'
  | 'images-missing-alt'
  | 'duplicate-content'
  | 'noindex'
  | 'heading-level-skipped'
  | 'url-too-long'
  | 'url-has-uppercase'
  | 'url-has-underscore'
  | 'url-excess-params';

export const ISSUE_LABEL: Record<PageIssueCode, string> = {
  'page-error': 'Pages with errors',
  'title-missing': 'Missing title tags',
  'title-too-short': 'Short title tags',
  'title-too-long': 'Long title tags',
  'meta-missing': 'Missing meta descriptions',
  'meta-too-short': 'Short meta descriptions',
  'meta-too-long': 'Long meta descriptions',
  'h1-missing': 'Missing H1 headings',
  'h1-multiple': 'Multiple H1 headings',
  'canonical-missing': 'Missing canonical tags',
  'canonical-malformed': 'Malformed canonical tags',
  'canonical-cross-domain': 'Cross-domain canonicals',
  'json-ld-missing': 'Pages with no JSON-LD',
  'json-ld-invalid': 'Pages with invalid JSON-LD',
  'thin-content': 'Thin content pages',
  'images-missing-alt': 'Images missing alt text',
  'duplicate-content': 'Duplicate content',
  noindex: 'Noindexed pages',
  'heading-level-skipped': 'Skipped heading levels',
  'url-too-long': 'Overlong URLs',
  'url-has-uppercase': 'URLs with uppercase characters',
  'url-has-underscore': 'URLs with underscores',
  'url-excess-params': 'URLs with excess parameters',
};
