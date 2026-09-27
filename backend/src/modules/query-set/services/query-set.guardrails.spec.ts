import { describe, expect, it } from 'vitest';
import {
  applyGuardrails,
  checkBucketCount,
  checkUnbrandedFloor,
  clampPerBucketCounts,
  isRationaleGrounded,
  rejectUngroundedBuckets,
  scaleToTier,
} from './query-set.guardrails.js';
import type { BucketProposal } from '../query-set.types.js';

const CONTEXT = ['Northwind Robotics', 'warehouse automation', 'picking robots', 'ACME Corp', 'Series B funded'];

function bucket(overrides: Partial<BucketProposal> = {}): BucketProposal {
  return {
    name: 'default-bucket',
    rationale: 'Cites warehouse automation directly.',
    persona: 'buyer',
    funnelStage: 'problem_aware',
    branding: 'unbranded',
    targetCount: 10,
    ...overrides,
  };
}

describe('isRationaleGrounded', () => {
  it('matches a real context term, case-insensitive', () => {
    expect(isRationaleGrounded('This cites WAREHOUSE AUTOMATION directly.', CONTEXT)).toBe(true);
  });
  it('rejects a rationale with no real context match', () => {
    expect(isRationaleGrounded('This is a generic claim about growth.', CONTEXT)).toBe(false);
  });
  it('ignores terms below the minimum length as too generic', () => {
    // 'B2B' style short terms would trivially match almost anything — the
    // guardrail requires a real, specific citation.
    expect(isRationaleGrounded('B2B is important.', ['B2', 'B2B'])).toBe(false);
  });
});

describe('rejectUngroundedBuckets', () => {
  it('keeps grounded buckets and drops ungrounded ones with a note', () => {
    const buckets = [
      bucket({ name: 'grounded', rationale: 'Targets warehouse automation buyers.' }),
      bucket({ name: 'ungrounded', rationale: 'A generic claim about excellence.' }),
    ];
    const result = rejectUngroundedBuckets(buckets, CONTEXT);
    expect(result.buckets.map((b) => b.name)).toEqual(['grounded']);
    expect(result.notes).toEqual([
      expect.objectContaining({ type: 'ungrounded-rationale', bucketName: 'ungrounded' }),
    ]);
  });
});

describe('clampPerBucketCounts', () => {
  it('clamps below the floor and above the ceiling', () => {
    const buckets = [bucket({ name: 'low', targetCount: 2 }), bucket({ name: 'high', targetCount: 100 })];
    const result = clampPerBucketCounts(buckets);
    expect(result.buckets.find((b) => b.name === 'low')!.targetCount).toBe(5);
    expect(result.buckets.find((b) => b.name === 'high')!.targetCount).toBe(40);
    expect(result.notes).toHaveLength(2);
  });
  it('leaves in-range counts untouched, no note', () => {
    const result = clampPerBucketCounts([bucket({ targetCount: 20 })]);
    expect(result.buckets[0]!.targetCount).toBe(20);
    expect(result.notes).toEqual([]);
  });
});

describe('scaleToTier', () => {
  it('scales proportionally when the proposal overshoots the tier budget', () => {
    // starter budget is 60; three buckets at 40 each = 120, double the budget.
    const buckets = [bucket({ name: 'a', targetCount: 40 }), bucket({ name: 'b', targetCount: 40 }), bucket({ name: 'c', targetCount: 40 })];
    const result = scaleToTier(buckets, 'starter');
    const total = result.buckets.reduce((s, b) => s + b.targetCount, 0);
    expect(total).toBeLessThanOrEqual(65); // re-clamped to the 5-floor per bucket, may land slightly over
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]!.type).toBe('scaled-to-tier');
  });
  it('leaves the proposal untouched when already within budget', () => {
    const buckets = [bucket({ targetCount: 10 })];
    const result = scaleToTier(buckets, 'full');
    expect(result.buckets).toEqual(buckets);
    expect(result.notes).toEqual([]);
  });
  it('never drops a bucket to fit — only shrinks counts', () => {
    const buckets = [bucket({ name: 'a', targetCount: 30 }), bucket({ name: 'b', targetCount: 30 }), bucket({ name: 'c', targetCount: 30 })];
    const result = scaleToTier(buckets, 'starter');
    expect(result.buckets).toHaveLength(3);
  });
});

describe('checkBucketCount', () => {
  it('flags too few buckets', () => {
    const notes = checkBucketCount([bucket(), bucket({ name: 'b' })]);
    expect(notes).toEqual([expect.objectContaining({ type: 'bucket-count-low' })]);
  });
  it('flags too many buckets', () => {
    const buckets = Array.from({ length: 15 }, (_, i) => bucket({ name: `b${i}` }));
    const notes = checkBucketCount(buckets);
    expect(notes).toEqual([expect.objectContaining({ type: 'bucket-count-high' })]);
  });
  it('passes a count within [4, 14]', () => {
    const buckets = Array.from({ length: 6 }, (_, i) => bucket({ name: `b${i}` }));
    expect(checkBucketCount(buckets)).toEqual([]);
  });
});

describe('checkUnbrandedFloor', () => {
  it('flags a proposal below the 70% unbranded floor', () => {
    const buckets = [
      bucket({ name: 'branded', branding: 'branded', targetCount: 50 }),
      bucket({ name: 'unbranded', branding: 'unbranded', targetCount: 50 }),
    ];
    const notes = checkUnbrandedFloor(buckets);
    expect(notes).toEqual([expect.objectContaining({ type: 'unbranded-floor' })]);
  });
  it('passes a proposal at or above the floor', () => {
    const buckets = [
      bucket({ name: 'branded', branding: 'branded', targetCount: 20 }),
      bucket({ name: 'unbranded', branding: 'unbranded', targetCount: 80 }),
    ];
    expect(checkUnbrandedFloor(buckets)).toEqual([]);
  });
});

describe('applyGuardrails', () => {
  it('runs the full pipeline in order: grounding first, then count/clamp/scale/floor', () => {
    const buckets = [
      bucket({ name: 'grounded-1', rationale: 'Targets warehouse automation buyers.', targetCount: 30, branding: 'unbranded' }),
      bucket({ name: 'grounded-2', rationale: 'References picking robots directly.', targetCount: 3, branding: 'unbranded' }),
      bucket({ name: 'ungrounded', rationale: 'A vague claim.', targetCount: 999 }),
    ];
    const result = applyGuardrails(buckets, CONTEXT, 'starter');
    expect(result.buckets.map((b) => b.name)).toEqual(['grounded-1', 'grounded-2']);
    expect(result.buckets.find((b) => b.name === 'grounded-2')!.targetCount).toBe(5); // clamped up from 3
    expect(result.notes.some((n) => n.type === 'ungrounded-rationale')).toBe(true);
  });
});
