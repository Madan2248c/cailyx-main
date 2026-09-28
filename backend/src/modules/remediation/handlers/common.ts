/**
 * Small shared helpers for handlers — reading the snapshot safely and
 * mapping audit severities onto the fix-spec label scale.
 *
 * @module remediation/handlers/common
 */

import type { FixLevel } from '../../../generated/prisma/enums.js';
import type { AuditCheckType, AuditFinding, Severity } from '../../technical-audit/technical-audit.types.js';
import type { FixSourceRef, SourceSnapshot } from '../remediation.types.js';

/** The technical-audit finding of this type, only when it actually failed. */
export function failedFinding(snapshot: SourceSnapshot, type: AuditCheckType): AuditFinding | null {
  const f = snapshot.technicalAudit?.findings.find((x) => x.type === type);
  return f && f.status === 'fail' ? f : null;
}

/** The finding of this type when the check ran at all (pass or fail). */
export function ranFinding(snapshot: SourceSnapshot, type: AuditCheckType): AuditFinding | null {
  const f = snapshot.technicalAudit?.findings.find((x) => x.type === type);
  return f && (f.status === 'fail' || f.status === 'pass') ? f : null;
}

export function technicalRef(snapshot: SourceSnapshot, findingRef: string): FixSourceRef {
  return { module: 'technical-audit', runId: snapshot.technicalAudit!.runId, findingRef };
}

export function level(severity: Severity | undefined): FixLevel {
  if (severity === 'high') return 'HIGH';
  if (severity === 'medium') return 'MEDIUM';
  return 'LOW';
}

export function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A display string for a detail value — strings and numbers as-is, anything else empty. */
export function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
