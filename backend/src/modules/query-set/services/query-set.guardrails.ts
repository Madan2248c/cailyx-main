/**
 * Deterministic guardrails over the raw bucket proposal from LLM call #1.
 * No I/O — pure functions over data, testable against synthetic proposals
 * without a live LLM. See docs/analysis/query-set.md "Guardrails".
 *
 * Applied in order: rationale-grounding rejection → bucket-count check →
 * per-bucket clamp → tier scaling → unbranded-floor check. Order matters:
 * ungrounded buckets are dropped before anything else sizes or counts them.
 *
 * @module query-set/services/query-set.guardrails
 */

import {
  MAX_BUCKETS,
  MAX_PROMPTS_PER_BUCKET,
  MIN_BUCKETS,
  MIN_GROUNDING_TERM_LENGTH,
  MIN_PROMPTS_PER_BUCKET,
  TIER_TARGET_SIZES,
  UNBRANDED_RATIO_FLOOR,
} from '../query-set.constants.js';
import type { BucketProposal, GroundingContext, GuardrailNote, GuardrailResult } from '../query-set.types.js';

/**
 * A bucket's rationale is grounded when it contains at least one real term
 * from the project's CompanyContextProfile (case-insensitive substring
 * match, terms below MIN_GROUNDING_TERM_LENGTH ignored as too generic to be
 * evidence of anything specific). Deliberately simple and deterministic —
 * not semantic similarity — so the same input always gets the same verdict.
 */
export function isRationaleGrounded(rationale: string, context: GroundingContext): boolean {
  const lower = rationale.toLowerCase();
  return context.some((term) => {
    const t = term.trim().toLowerCase();
    return t.length >= MIN_GROUNDING_TERM_LENGTH && lower.includes(t);
  });
}

/**
 * Drop any bucket whose rationale doesn't cite anything in the grounding
 * context — before generation spends budget on it. Runs first: everything
 * downstream (bucket-count check, tier scaling) operates on what survives.
 */
export function rejectUngroundedBuckets(buckets: BucketProposal[], context: GroundingContext): GuardrailResult {
  const notes: GuardrailNote[] = [];
  const kept = buckets.filter((b) => {
    const grounded = isRationaleGrounded(b.rationale, context);
    if (!grounded) {
      notes.push({
        type: 'ungrounded-rationale',
        bucketName: b.name,
        detail: `Bucket "${b.name}" rejected: rationale "${b.rationale}" cites nothing found in the project's context.`,
      });
    }
    return grounded;
  });
  return { buckets: kept, notes };
}

/** Clamps each bucket's targetCount into [MIN_PROMPTS_PER_BUCKET, MAX_PROMPTS_PER_BUCKET]. */
export function clampPerBucketCounts(buckets: BucketProposal[]): GuardrailResult {
  const notes: GuardrailNote[] = [];
  const clamped = buckets.map((b) => {
    const bounded = Math.min(MAX_PROMPTS_PER_BUCKET, Math.max(MIN_PROMPTS_PER_BUCKET, Math.round(b.targetCount)));
    if (bounded !== b.targetCount) {
      notes.push({
        type: 'per-bucket-clamped',
        bucketName: b.name,
        detail: `Bucket "${b.name}" targetCount ${b.targetCount} clamped to ${bounded}.`,
      });
    }
    return { ...b, targetCount: bounded };
  });
  return { buckets: clamped, notes };
}

/**
 * Scales bucket targetCounts proportionally down to fit the tier's total
 * budget when the proposal overshoots — never drops a bucket ad hoc to make
 * the total fit. Re-clamps to MIN_PROMPTS_PER_BUCKET after scaling, since a
 * proportional cut can push a small bucket below the floor; the total may
 * then land slightly over budget, which is preferred to silently erasing a
 * bucket the rationale-grounding check already approved.
 */
export function scaleToTier(buckets: BucketProposal[], tier: string): GuardrailResult {
  const budget = TIER_TARGET_SIZES[tier] ?? TIER_TARGET_SIZES.full!;
  const total = buckets.reduce((s, b) => s + b.targetCount, 0);
  if (total <= budget || total === 0) return { buckets, notes: [] };

  const ratio = budget / total;
  const notes: GuardrailNote[] = [
    { type: 'scaled-to-tier', detail: `Total proposed ${total} exceeds tier "${tier}" budget ${budget}; scaled by ${ratio.toFixed(3)}.` },
  ];
  const scaled = buckets.map((b) => ({
    ...b,
    targetCount: Math.max(MIN_PROMPTS_PER_BUCKET, Math.round(b.targetCount * ratio)),
  }));
  return { buckets: scaled, notes };
}

/**
 * Checks (does not fix) bucket count is within [MIN_BUCKETS, MAX_BUCKETS].
 * Out-of-range is a note for the caller to act on — see
 * `QuerySetGenerationService`, which rejects the whole proposal rather than
 * inventing or deleting buckets to force a count.
 */
export function checkBucketCount(buckets: BucketProposal[]): GuardrailNote[] {
  if (buckets.length < MIN_BUCKETS) {
    return [{ type: 'bucket-count-low', detail: `Only ${buckets.length} buckets survived grounding; minimum is ${MIN_BUCKETS}.` }];
  }
  if (buckets.length > MAX_BUCKETS) {
    return [{ type: 'bucket-count-high', detail: `${buckets.length} buckets proposed; maximum is ${MAX_BUCKETS}.` }];
  }
  return [];
}

/**
 * Checks the unbranded-prompt ratio floor over the buckets' targetCounts
 * (post-clamping/scaling — the ratio that will actually be generated).
 * Does not fix — the caller decides what to do (see the orchestrator).
 */
export function checkUnbrandedFloor(buckets: BucketProposal[]): GuardrailNote[] {
  const total = buckets.reduce((s, b) => s + b.targetCount, 0);
  if (total === 0) return [];
  const unbranded = buckets.filter((b) => b.branding === 'unbranded').reduce((s, b) => s + b.targetCount, 0);
  const ratio = unbranded / total;
  if (ratio < UNBRANDED_RATIO_FLOOR) {
    return [
      {
        type: 'unbranded-floor',
        detail: `Unbranded ratio ${(ratio * 100).toFixed(1)}% is below the ${(UNBRANDED_RATIO_FLOOR * 100).toFixed(0)}% floor.`,
      },
    ];
  }
  return [];
}

/**
 * Runs every guardrail in the documented order and returns the final
 * bucket list plus every note collected along the way. Does not throw —
 * bucket-count and unbranded-floor violations are notes the caller (the
 * generation service) turns into a rejected proposal.
 */
export function applyGuardrails(buckets: BucketProposal[], context: GroundingContext, tier: string): GuardrailResult {
  const notes: GuardrailNote[] = [];

  const grounded = rejectUngroundedBuckets(buckets, context);
  notes.push(...grounded.notes);

  const bucketCountNotes = checkBucketCount(grounded.buckets);
  notes.push(...bucketCountNotes);

  const clamped = clampPerBucketCounts(grounded.buckets);
  notes.push(...clamped.notes);

  const scaled = scaleToTier(clamped.buckets, tier);
  notes.push(...scaled.notes);

  const unbrandedNotes = checkUnbrandedFloor(scaled.buckets);
  notes.push(...unbrandedNotes);

  return { buckets: scaled.buckets, notes };
}
