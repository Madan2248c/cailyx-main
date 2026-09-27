/**
 * The fix-spec status machine — pure, so every allowed and forbidden
 * transition is unit-tested without a database.
 *
 * `VERIFIED` is deliberately absent from every manual target list: only a
 * verifier (live check or a newer audit) can set it. A person or an agent
 * saying "done" is `APPLIED`.
 *
 * @module remediation/services/fix-status
 */

import type { FixStatus } from '../../../generated/prisma/enums.js';

/** Moves a person may make through `PATCH …/status`. */
export const MANUAL_TRANSITIONS: Readonly<Record<FixStatus, readonly FixStatus[]>> = {
  OPEN: ['IN_PROGRESS', 'APPLIED', 'DISMISSED'],
  AWAITING_DECISION: ['DISMISSED'],
  IN_PROGRESS: ['OPEN', 'APPLIED', 'DISMISSED'],
  APPLIED: ['OPEN', 'IN_PROGRESS', 'DISMISSED'],
  VERIFIED: [],
  REGRESSED: ['IN_PROGRESS', 'APPLIED', 'DISMISSED'],
  DISMISSED: ['OPEN'],
};

/** Statuses a verifier may run from. */
export const VERIFIABLE: readonly FixStatus[] = ['OPEN', 'IN_PROGRESS', 'APPLIED', 'REGRESSED'];

/** Statuses a sync may settle as fixed when a newer audit no longer reports the problem. */
export const RECONCILABLE: readonly FixStatus[] = ['OPEN', 'AWAITING_DECISION', 'IN_PROGRESS', 'APPLIED', 'REGRESSED'];

/** Statuses an agent or person still has work to do on. */
export const ACTIONABLE: readonly FixStatus[] = ['OPEN', 'IN_PROGRESS', 'REGRESSED'];

export function canMove(from: FixStatus, to: FixStatus): boolean {
  return MANUAL_TRANSITIONS[from].includes(to);
}

/**
 * Where a failed live verification leaves a spec: an `APPLIED` fix that
 * doesn't hold goes back to `OPEN` (the work isn't done); anything else stays
 * where it was.
 */
export function afterFailedVerify(from: FixStatus): FixStatus {
  return from === 'APPLIED' ? 'OPEN' : from;
}

/** Reopening a dismissed spec that still needs the client's call goes back to waiting for it. */
export function reopenTarget(needsClientDecision: boolean, decision: string | null): FixStatus {
  return needsClientDecision && decision !== 'APPROVED' ? 'AWAITING_DECISION' : 'OPEN';
}
