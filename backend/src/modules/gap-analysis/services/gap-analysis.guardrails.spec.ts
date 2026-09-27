import { describe, expect, it } from 'vitest';
import {
  assignRanks,
  checkRecommendationCount,
  hasNoFabricatedNumbers,
  isFullyGrounded,
  rejectUngroundedRecommendations,
} from './gap-analysis.guardrails.js';
import type { RawRecommendation, SourceFinding } from '../gap-analysis.types.js';

const FINDINGS: SourceFinding[] = [
  { module: 'technical-audit', findingRef: 'sitemap', summary: 'Sitemap found with 214 URLs, updated 3 days ago.' },
  { module: 'social-activity', findingRef: 'linkedin:dormant-platform', summary: 'No posts in the window on linkedin.' },
];

function rec(overrides: Partial<RawRecommendation> = {}): RawRecommendation {
  return {
    title: 'Fix it',
    description: 'Do the thing described in the sitemap finding.',
    sourceFindings: [{ module: 'technical-audit', findingRef: 'sitemap' }],
    ...overrides,
  };
}

describe('isFullyGrounded', () => {
  it('is true when every citation resolves to a real collected finding', () => {
    expect(isFullyGrounded(rec(), FINDINGS)).toBe(true);
  });
  it('is false when a citation names a module/ref pair not in the collected data', () => {
    expect(isFullyGrounded(rec({ sourceFindings: [{ module: 'technical-audit', findingRef: 'not-a-real-finding' }] }), FINDINGS)).toBe(false);
  });
  it('is false with zero citations — every recommendation must ground to something', () => {
    expect(isFullyGrounded(rec({ sourceFindings: [] }), FINDINGS)).toBe(false);
  });
});

describe('hasNoFabricatedNumbers', () => {
  it('passes when every number in the text already appears in a cited finding', () => {
    const r = rec({ description: 'The sitemap has 214 URLs — good coverage.' });
    expect(hasNoFabricatedNumbers(r, FINDINGS)).toBe(true);
  });
  it('fails when a number is invented — not present in any cited finding', () => {
    const r = rec({ description: 'This will improve visibility by 42%.' });
    expect(hasNoFabricatedNumbers(r, FINDINGS)).toBe(false);
  });
  it('ignores bare single digits — too common to be a meaningful fabricated-score signal', () => {
    const r = rec({ description: 'Do this in 3 steps.' });
    expect(hasNoFabricatedNumbers(r, FINDINGS)).toBe(true);
  });
  it('only checks grounding text from the findings THIS recommendation cites, not the whole pool', () => {
    // "dormant" finding has no numbers; citing only it while stating "214" must fail
    // even though 214 exists in a DIFFERENT finding this recommendation didn't cite.
    const r = rec({ description: 'This affects 214 things.', sourceFindings: [{ module: 'social-activity', findingRef: 'linkedin:dormant-platform' }] });
    expect(hasNoFabricatedNumbers(r, FINDINGS)).toBe(false);
  });
});

describe('rejectUngroundedRecommendations', () => {
  it('drops ungrounded and fabricated-number items, keeps clean ones', () => {
    const recs = [
      rec({ title: 'clean' }),
      rec({ title: 'bad-citation', sourceFindings: [{ module: 'aeo-audit', findingRef: 'nope' }] }),
      rec({ title: 'fabricated-number', description: 'Improves by 99%.' }),
    ];
    const { kept, notes } = rejectUngroundedRecommendations(recs, FINDINGS);
    expect(kept.map((r) => r.title)).toEqual(['clean']);
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.type)).toEqual(['ungrounded-citation', 'fabricated-number']);
  });
});

describe('checkRecommendationCount', () => {
  it('flags too few', () => {
    expect(checkRecommendationCount([rec(), rec()])).toEqual([expect.objectContaining({ type: 'item-count-low' })]);
  });
  it('flags too many', () => {
    const recs = Array.from({ length: 16 }, () => rec());
    expect(checkRecommendationCount(recs)).toEqual([expect.objectContaining({ type: 'item-count-high' })]);
  });
  it('passes a count within [3, 15]', () => {
    expect(checkRecommendationCount([rec(), rec(), rec()])).toEqual([]);
  });
});

describe('assignRanks', () => {
  it('assigns contiguous 1-based ranks in the given order', () => {
    const ranked = assignRanks([rec({ title: 'a' }), rec({ title: 'b' }), rec({ title: 'c' })]);
    expect(ranked.map((r) => r.priorityRank)).toEqual([1, 2, 3]);
    expect(ranked.map((r) => r.title)).toEqual(['a', 'b', 'c']);
  });
  it('never assigns a rank beyond the max, even if given more items', () => {
    const recs = Array.from({ length: 20 }, (_, i) => rec({ title: `r${i}` }));
    const ranked = assignRanks(recs);
    expect(ranked.length).toBeLessThanOrEqual(15);
  });
});
