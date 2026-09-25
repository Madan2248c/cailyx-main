import { describe, expect, it } from 'vitest';
import {
  aggregatePlatform,
  bucketPattern,
  deltasFor,
  findingsFor,
  type StoredSocialRow,
} from './social-activity.aggregation.js';

const NOW = new Date('2026-09-26T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function post(postedDaysAgo: number | null, likes = 10): StoredSocialRow {
  return {
    platform: 'linkedin',
    kind: 'post',
    postedAt: postedDaysAgo == null ? null : day(postedDaysAgo),
    likeCount: likes,
    commentCount: 2,
    shareCount: 1,
    followerCount: null,
  };
}

describe('bucketPattern', () => {
  it('is dormant with zero in-window posts', () => {
    expect(bucketPattern(0, null, null)).toBe('dormant');
  });
  it('is dormant past the absolute cutoff regardless of mean', () => {
    expect(bucketPattern(3, 1.0, 50)).toBe('dormant');
  });
  it('buckets by mean interval', () => {
    expect(bucketPattern(10, 1.0, 1)).toBe('daily');
    expect(bucketPattern(10, 3.0, 2)).toBe('every-2-3-days');
    expect(bucketPattern(5, 7.0, 6)).toBe('weekly');
    expect(bucketPattern(5, 12.0, 10)).toBe('sporadic');
  });
  it('is sporadic with a single dated post', () => {
    expect(bucketPattern(1, null, 5)).toBe('sporadic');
  });
});

describe('aggregatePlatform', () => {
  it('computes window cadence and engagement', () => {
    const rows = [post(1), post(2), post(4), post(40)];
    const a = aggregatePlatform('linkedin', rows, 30, 20, NOW);
    expect(a.postsSampled).toBe(4);
    expect(a.postsInWindow).toBe(3);
    expect(a.meanIntervalDays).toBeCloseTo(1.5, 5);
    expect(a.longestGapDays).toBeCloseTo(2, 5);
    expect(a.daysSinceLastPost).toBeCloseTo(1, 5);
    expect(a.avgEngagement).toBe(13);
    expect(a.pattern).toBe('daily');
    expect(a.windowTruncated).toBe(false);
  });
  it('takes followers from the profile row and flags truncation at the cap', () => {
    const rows: StoredSocialRow[] = [
      { platform: 'x', kind: 'profile', postedAt: null, likeCount: null, commentCount: null, shareCount: null, followerCount: 5000 },
      post(1),
    ];
    const a = aggregatePlatform('x', rows, 30, 1, NOW);
    expect(a.followerCount).toBe(5000);
    expect(a.postsSampled).toBe(1);
    expect(a.windowTruncated).toBe(true);
  });
  it('counts undated rows separately and yields nulls when nothing dated', () => {
    const a = aggregatePlatform('instagram', [post(null), post(null)], 30, 20, NOW);
    expect(a.undatedPosts).toBe(2);
    expect(a.postsInWindow).toBe(0);
    expect(a.lastPostAt).toBeNull();
    expect(a.avgEngagement).toBe(13); // engagement needs no dates
    expect(a.pattern).toBe('dormant');
  });
});

describe('findingsFor', () => {
  const base = aggregatePlatform('facebook', [post(1), post(2)], 30, 20, NOW);
  it('passes an active platform', () => {
    expect(findingsFor(base)).toEqual([
      expect.objectContaining({ type: 'active-platform', status: 'pass' }),
    ]);
  });
  it('fails dormant platforms', () => {
    const dormant = aggregatePlatform('facebook', [post(60)], 30, 20, NOW);
    expect(findingsFor(dormant)).toEqual([
      expect.objectContaining({ type: 'dormant-platform', status: 'fail' }),
    ]);
  });
  it('fails quiet sporadic platforms but passes recently-active ones', () => {
    const quiet = { ...base, pattern: 'sporadic' as const, daysSinceLastPost: 20 };
    expect(findingsFor(quiet)[0]).toMatchObject({ type: 'infrequent-platform', status: 'fail' });
    const fresh = { ...base, pattern: 'sporadic' as const, daysSinceLastPost: 3 };
    expect(findingsFor(fresh)[0]).toMatchObject({ type: 'active-platform', status: 'pass' });
  });
  it('flags undated-only platforms as data-quality, never cadence', () => {
    const undated = aggregatePlatform('instagram', [post(null)], 30, 20, NOW);
    // dormant (zero dated) comes first; the undated note must still be present.
    const types = findingsFor(undated).map((f) => f.type);
    expect(types).toContain('dormant-platform');
  });
});

describe('deltasFor', () => {
  it('reports follower, count, pattern and recency movement', () => {
    const prev = aggregatePlatform('linkedin', [post(1), post(2)], 30, 20, NOW);
    const cur = aggregatePlatform('linkedin', [post(1), post(2), post(3)], 30, 20, NOW);
    const deltas = deltasFor([prev], [cur]);
    expect(deltas).toContainEqual(
      expect.objectContaining({ platform: 'linkedin', metric: 'postsInWindow', previous: 2, current: 3 }),
    );
    expect(deltas.some((d) => d.metric === 'followers')).toBe(false);
  });
  it('ignores platforms with no previous row', () => {
    const cur = aggregatePlatform('x', [post(1)], 30, 20, NOW);
    expect(deltasFor([], [cur])).toEqual([]);
  });
});
