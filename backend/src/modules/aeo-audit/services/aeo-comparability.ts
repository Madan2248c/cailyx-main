/**
 * Comparability check — a stable key from (querySetId, surfaces, markets),
 * so a trend claim is only ever made between two audits that asked the
 * same questions on the same engines in the same markets. Ported
 * near-verbatim from the old repo's `aeo-comparability.ts`. Pure, no I/O.
 *
 * @module aeo-audit/services/aeo-comparability
 */

export interface ComparableAuditFields {
  querySetId: string | null;
  surfaces: string[];
  markets: string[];
}

/** A stable key, or null when there's nothing to compare against (e.g. a legacy row with no querySetId). */
export function auditComparabilityKey(audit: ComparableAuditFields): string | null {
  if (!audit.querySetId) return null;
  const surfaces = [...audit.surfaces].sort().join(',');
  const markets = [...audit.markets].sort().join(',');
  return `${audit.querySetId}|${surfaces}|${markets}`;
}

/** True iff both audits have a real, equal comparability key — different question/engine/market set is a methodology break, never diffed as if it were a real change. */
export function areAuditsComparable(a: ComparableAuditFields, b: ComparableAuditFields): boolean {
  const keyA = auditComparabilityKey(a);
  const keyB = auditComparabilityKey(b);
  return keyA !== null && keyB !== null && keyA === keyB;
}
