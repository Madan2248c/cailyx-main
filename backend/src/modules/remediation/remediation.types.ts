/**
 * Remediation vocabulary — the snapshot every handler reads, the draft every
 * handler emits, the generated-fix (artifact) shape, and the machine-checkable
 * acceptance checks a verifier runs. See docs/analysis/remediation.md.
 *
 * @module remediation/remediation.types
 */

import type { FixClass, FixLevel, FixMethod } from '../../generated/prisma/enums.js';
import type { AuditFinding, PageIssueCode } from '../technical-audit/technical-audit.types.js';
import type { SocialActivityFinding } from '../social-activity/social-activity.types.js';

export type FixSourceModule = 'technical-audit' | 'social-activity' | 'aeo-audit';

/** One grounding citation — same `(module, findingRef)` format Gap Analysis cites. */
export interface FixSourceRef {
  module: FixSourceModule;
  runId: string;
  findingRef: string;
}

/** One crawled page from the latest technical audit (`audit_pages`). */
export interface SnapshotPage {
  url: string;
  statusCode: number;
  score: number;
  issues: PageIssueCode[];
  signals: {
    title?: string | null;
    titleLength?: number | null;
    metaDescription?: string | null;
    metaDescLength?: number | null;
    h1Count?: number | null;
    canonical?: string | null;
    wordCount?: number | null;
    imagesMissingAlt?: number | null;
    jsonLdTypes?: string[];
  };
}

/** Confirmed company facts from Discovery — the only inputs a generated artifact may use. */
export interface CompanyFacts {
  name: string | null;
  url: string;
  description: string | null;
  logoUrl: string | null;
  /** Verified social profile URLs, for `sameAs`. */
  sameAs: string[];
  offerings: string[];
}

/** Everything one sync reads, collected once via each source module's own exported service. */
export interface SourceSnapshot {
  clientId: string;
  projectId: string;
  projectName: string;
  /** `https://<domain>` — the site origin. */
  siteUrl: string;
  technicalAudit: {
    runId: string;
    completedAt: Date;
    findings: AuditFinding[];
    /** Worst pages first, as `TechnicalAuditService.getRun` returns them. */
    pages: SnapshotPage[];
  } | null;
  socialActivity: {
    runId: string;
    completedAt: Date;
    findings: SocialActivityFinding[];
  } | null;
  aeoAudit: {
    runId: string;
    completedAt: Date;
    headlines: string[];
    losingPrompts: Array<{ observationId: string; prompt: string; losesTo: string[] }>;
    /** Prompts the client now wins — the only evidence that a losing-prompt fix worked. */
    winningPrompts: string[];
  } | null;
  company: CompanyFacts | null;
  gapAnalysis: {
    runId: string;
    recommendations: Array<{ id: string; sourceFindings: Array<{ module: string; findingRef: string }> }>;
  } | null;
}

// ─── The generated fix ───────────────────────────────────────────────────────

export type ArtifactKind = 'file' | 'html-snippet' | 'json-ld' | 'copy';

export interface Artifact {
  kind: ArtifactKind;
  /** Site path the file belongs at, e.g. `/robots.txt`. */
  path?: string;
  /** e.g. 'text', 'html', 'json', 'markdown'. */
  language: string;
  /** Where a snippet goes, e.g. 'inside <head> on every page'. */
  placement?: string;
  content: string;
}

// ─── Acceptance checks ───────────────────────────────────────────────────────

export type AcceptanceCheck =
  | { kind: 'robots-exists' }
  | { kind: 'robots-allows'; bots: string[] }
  | { kind: 'robots-declares-sitemap' }
  | { kind: 'json-ld-has'; url: string; type: 'Organization'; fields: string[] }
  | { kind: 'page-issue-absent'; url: string; issues: PageIssueCode[] }
  | { kind: 'finding-absent'; module: FixSourceModule; findingRef: string }
  /** A fix an admin added by hand: no machine check, a person confirms it is done. */
  | { kind: 'manual' };

/** Acceptance kinds a live verifier can check right now; the rest wait for a newer audit. */
export const LIVE_ACCEPTANCE_KINDS: ReadonlyArray<AcceptanceCheck['kind']> = [
  'robots-exists',
  'robots-allows',
  'robots-declares-sitemap',
  'json-ld-has',
  'page-issue-absent',
];

export interface VerifyResult {
  passed: boolean;
  checkedAt: string;
  kind: AcceptanceCheck['kind'];
  /** What was observed, in plain words. */
  observed: string;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/** One fix, as a handler proposes it — before guardrails, merge and persistence. */
export interface FixSpecDraft {
  problemKey: string;
  target: string;
  fixClass: FixClass;
  method: FixMethod;
  groupKey: string;
  severity: FixLevel;
  effort: FixLevel;
  title: string;
  evidence: Record<string, unknown>;
  sources: FixSourceRef[];
  steps: string[];
  acceptance: AcceptanceCheck;
  artifact?: Artifact;
  artifactError?: string;
  needsClientDecision?: boolean;
}

/**
 * One problem family. `detect` is pure and deterministic: it reads the
 * snapshot and returns zero or more drafts, with any generated artifact
 * already built. No I/O, no LLM — so every handler is unit-testable from a
 * fixture snapshot.
 */
export interface RemediationHandler {
  /** Stable id, used in logs and tests. */
  id: string;
  detect(snapshot: SourceSnapshot): FixSpecDraft[];
}

export interface DroppedDraft {
  problemKey: string;
  target: string;
  reason: string;
}
