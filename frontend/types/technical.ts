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
