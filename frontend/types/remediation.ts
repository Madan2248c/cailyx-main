/**
 * Fix Plan (remediation) types — a mirror of the backend's client-facing
 * shapes. See docs/analysis/remediation-client-portal.md.
 */

export type FixStatus = 'OPEN' | 'AWAITING_DECISION' | 'IN_PROGRESS' | 'APPLIED' | 'VERIFIED' | 'REGRESSED' | 'DISMISSED';
export type FixClass = 'CODE' | 'CONFIG' | 'CONTENT' | 'OFF_SITE' | 'INVESTIGATE';
export type FixMethod = 'GENERATED' | 'LLM_DRAFT' | 'INSTRUCTIONS' | 'HUMAN';
export type FixLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface FixArtifact {
  kind: 'file' | 'html-snippet' | 'json-ld' | 'copy';
  path?: string;
  language: string;
  placement?: string;
  content: string;
}

export type AcceptanceCheck =
  | { kind: 'robots-exists' }
  | { kind: 'robots-allows'; bots: string[] }
  | { kind: 'robots-declares-sitemap' }
  | { kind: 'json-ld-has'; url: string; type: 'Organization'; fields: string[] }
  | { kind: 'page-issue-absent'; url: string; issues: string[] }
  | { kind: 'finding-absent'; module: string; findingRef: string };

export interface VerifyResult {
  passed: boolean;
  checkedAt: string;
  kind: AcceptanceCheck['kind'];
  observed: string;
}

export interface FixEvent {
  id: string;
  kind: 'status' | 'decision' | 'verify' | 'draft' | 'sync';
  fromStatus: FixStatus | null;
  toStatus: FixStatus | null;
  /** "You", "Your team", "Rothenhall" or "Automatic check" for client users. */
  actor: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface FixSpec {
  id: string;
  projectId: string;
  problemKey: string;
  target: string;
  fixClass: FixClass;
  method: FixMethod;
  groupKey: string;
  severity: FixLevel;
  effort: FixLevel;
  title: string;
  evidence: Record<string, unknown>;
  artifact: FixArtifact | null;
  artifactError: string | null;
  steps: string[];
  acceptance: AcceptanceCheck;
  llmDraft: { kind: string; content: Record<string, unknown> } | null;
  draftShared: boolean;
  needsClientDecision: boolean;
  decision: 'APPROVED' | 'DECLINED' | null;
  decisionNote: string | null;
  status: FixStatus;
  gapRecommendationId: string | null;
  prUrl: string | null;
  dismissedReason: string | null;
  lastReportedAt: string;
  lastVerifiedAt: string | null;
  lastVerifyResult: VerifyResult | null;
  createdAt: string;
  updatedAt: string;
  events?: FixEvent[];
}

export interface FixSummary {
  total: number;
  byStatus: Partial<Record<FixStatus, number>>;
  byClass: Partial<Record<FixClass, number>>;
  openHigh: number;
  awaitingDecision: number;
  regressed: number;
  verified: number;
  verifiedSinceBaseline: number;
  baselineAt: string | null;
}

/** Acceptance kinds the site can be re-checked for right now (the rest wait for the next audit). */
export const LIVE_CHECKS: ReadonlyArray<AcceptanceCheck['kind']> = [
  'robots-exists',
  'robots-allows',
  'robots-declares-sitemap',
  'json-ld-has',
  'page-issue-absent',
];

export const STATUS_WORD: Record<FixStatus, string> = {
  OPEN: 'To do',
  AWAITING_DECISION: 'Needs your decision',
  IN_PROGRESS: 'In progress',
  APPLIED: 'Applied, checking',
  VERIFIED: 'Verified',
  REGRESSED: 'Came back',
  DISMISSED: 'Not needed',
};

export const CLASS_WORD: Record<FixClass, string> = {
  CODE: 'Website code',
  CONFIG: 'Site settings',
  CONTENT: 'Content',
  OFF_SITE: 'Off-site',
  INVESTIGATE: 'Needs a look',
};

export const GROUP_WORD: Record<string, string> = {
  robots: 'Robots.txt',
  sitemap: 'Sitemap',
  schema: 'Structured data',
  cdn: 'CDN and firewall',
  rendering: 'JavaScript rendering',
  performance: 'Page speed',
  'agent-readiness': 'AI agent readiness',
  social: 'Social channels',
  'aeo-content': 'AI answer content',
  'page.title': 'Page titles',
  'page.meta': 'Meta descriptions',
  'page.h1': 'Headings',
  'page.canonical': 'Canonical tags',
  'page.thin': 'Thin content',
  'page.images': 'Image alt text',
  'page.duplicate': 'Duplicate pages',
  'page.noindex': 'Hidden pages',
  'page.heading': 'Heading structure',
  'page.json': 'Page structured data',
  'page.page': 'Broken pages',
  'page.url': 'URLs',
};

export function groupLabel(groupKey: string): string {
  return GROUP_WORD[groupKey] ?? groupKey.replace(/^page\./, '').replace(/[-.]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Plain-language "done when" for the acceptance check. */
export function describeAcceptance(check: AcceptanceCheck): string {
  switch (check.kind) {
    case 'robots-exists':
      return 'Your robots.txt file loads.';
    case 'robots-allows':
      return `robots.txt lets ${check.bots.join(', ')} read your site.`;
    case 'robots-declares-sitemap':
      return 'robots.txt points crawlers to your sitemap.';
    case 'json-ld-has':
      return `Your homepage describes your company to machines (${check.fields.join(', ')}).`;
    case 'page-issue-absent':
      return 'The page no longer shows this issue.';
    case 'finding-absent':
      return 'The next audit no longer finds this problem.';
  }
}
