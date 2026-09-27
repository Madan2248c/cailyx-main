import { describe, expect, it } from 'vitest';
import { FixStatus } from '../../../generated/prisma/enums.js';
import { afterFailedVerify, canMove, MANUAL_TRANSITIONS, reopenTarget } from './fix-status.js';

describe('fix status machine', () => {
  const all = Object.values(FixStatus);

  it('no manual move can ever reach VERIFIED', () => {
    for (const from of all) expect(canMove(from, 'VERIFIED')).toBe(false);
  });

  it('a VERIFIED fix cannot be moved by hand at all', () => {
    expect(MANUAL_TRANSITIONS.VERIFIED).toEqual([]);
  });

  it('AWAITING_DECISION only leaves by dismissal (or the decision endpoint)', () => {
    expect(all.filter((to) => canMove('AWAITING_DECISION', to))).toEqual(['DISMISSED']);
  });

  it('the everyday path is allowed', () => {
    expect(canMove('OPEN', 'IN_PROGRESS')).toBe(true);
    expect(canMove('IN_PROGRESS', 'APPLIED')).toBe(true);
    expect(canMove('REGRESSED', 'IN_PROGRESS')).toBe(true);
    expect(canMove('DISMISSED', 'OPEN')).toBe(true);
  });

  it('forbidden shortcuts are rejected', () => {
    expect(canMove('DISMISSED', 'APPLIED')).toBe(false);
    expect(canMove('OPEN', 'REGRESSED')).toBe(false);
    expect(canMove('OPEN', 'AWAITING_DECISION')).toBe(false);
  });

  it('a failed verification sends APPLIED back to OPEN and leaves others alone', () => {
    expect(afterFailedVerify('APPLIED')).toBe('OPEN');
    expect(afterFailedVerify('REGRESSED')).toBe('REGRESSED');
    expect(afterFailedVerify('OPEN')).toBe('OPEN');
  });

  it('reopening a decision-gated fix goes back to waiting for the decision', () => {
    expect(reopenTarget(true, null)).toBe('AWAITING_DECISION');
    expect(reopenTarget(true, 'DECLINED')).toBe('AWAITING_DECISION');
    expect(reopenTarget(true, 'APPROVED')).toBe('OPEN');
    expect(reopenTarget(false, null)).toBe('OPEN');
  });
});
