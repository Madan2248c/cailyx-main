import { describe, expect, it } from 'vitest';
import { buildVerdict, type VerdictObservation, type VerdictStance } from './aeo-verdict.js';

function obs(overrides: Partial<VerdictObservation>): VerdictObservation {
  return {
    id: 'o1',
    prompt: 'p',
    mentioned: false,
    cited: false,
    surface: 'cloro_chatgpt',
    bucketName: 'bucket-a',
    funnelStage: 'problem_aware',
    branding: 'unbranded',
    ...overrides,
  };
}

describe('buildVerdict — counted metrics', () => {
  it('computes overall mention/citation rates', () => {
    const v = buildVerdict([obs({ id: '1', mentioned: true, cited: true }), obs({ id: '2', mentioned: false, cited: false })], [], 'Acme');
    expect(v.counted.overall).toEqual({ observations: 2, mentionRate: 0.5, citationRate: 0.5 });
  });

  it('omits unbranded/branded slices with zero observations rather than zeroing them', () => {
    const v = buildVerdict([obs({ id: '1', branding: 'unbranded', mentioned: true })], [], 'Acme');
    expect(v.counted.unbranded).toEqual({ observations: 1, mentionRate: 1, citationRate: 0 });
    expect(v.counted.branded).toBeNull();
  });

  it('groups by bucket, funnel stage, and surface', () => {
    const v = buildVerdict(
      [
        obs({ id: '1', bucketName: 'a', funnelStage: 'problem_aware', surface: 'cloro_chatgpt', mentioned: true }),
        obs({ id: '2', bucketName: 'b', funnelStage: 'product_aware', surface: 'cloro_gemini', mentioned: false }),
      ],
      [],
      'Acme',
    );
    expect(v.counted.byBucket).toHaveLength(2);
    expect(v.counted.byFunnelStage).toHaveLength(2);
    expect(v.counted.bySurface).toHaveLength(2);
  });

  it('skips null bucket names (manual, unbucketed items) from byBucket', () => {
    const v = buildVerdict([obs({ id: '1', bucketName: null })], [], 'Acme');
    expect(v.counted.byBucket).toEqual([]);
  });
});

describe('buildVerdict — no composite score', () => {
  it('never produces a single overall score field', () => {
    const v = buildVerdict([obs({ id: '1', mentioned: true })], [], 'Acme');
    expect(v).not.toHaveProperty('score');
    expect(v.counted).not.toHaveProperty('score');
  });
});

describe('buildVerdict — competitor standing', () => {
  it('tallies ahead/behind/coMentions across stances', () => {
    const stances: VerdictStance[] = [
      { observationId: '1', stance: 'recommended_primary', recommendedOver: ['Rival A'], losesTo: [], brandsNamed: ['Rival A'] },
      { observationId: '2', stance: 'mentioned_neutral', recommendedOver: [], losesTo: ['Rival A'], brandsNamed: ['Rival A', 'Rival B'] },
    ];
    const v = buildVerdict([obs({ id: '1' }), obs({ id: '2' })], stances, 'Acme');
    const rivalA = v.counted.competitorStanding.find((c) => c.name === 'Rival A')!;
    expect(rivalA.timesAhead).toBe(1);
    expect(rivalA.timesBehind).toBe(1);
    const rivalB = v.counted.competitorStanding.find((c) => c.name === 'Rival B')!;
    expect(rivalB.coMentions).toBe(1);
    expect(rivalB.timesAhead).toBe(0);
  });

  // Regression: a first live run against a real project showed the subject's
  // own brand and a non-competitor platform ("G2") in competitorStanding
  // with real coMentions counts — buildCompetitorStanding was tallying the
  // raw, unfiltered brandsNamed list straight into rival standings. See
  // docs/chagelog.md.
  it('never counts the subject brand or a non-competitor platform as a rival', () => {
    const stances: VerdictStance[] = [
      { observationId: '1', stance: 'mentioned_neutral', recommendedOver: [], losesTo: [], brandsNamed: ['Acme', 'G2', 'Real Rival'] },
    ];
    const v = buildVerdict([obs({ id: '1' })], stances, 'Acme');
    expect(v.counted.competitorStanding.find((c) => c.name === 'Acme')).toBeUndefined();
    expect(v.counted.competitorStanding.find((c) => c.name === 'G2')).toBeUndefined();
    expect(v.counted.competitorStanding.find((c) => c.name === 'Real Rival')).toBeDefined();
  });

  it('still counts a known, tracked competitor as a co-mention even when it was never explicitly ranked', () => {
    // A known competitor that's merely named alongside the subject (not
    // placed ahead/behind) must still show up here — this is what the
    // subject-name/platform filter must NOT also exclude.
    const stances: VerdictStance[] = [
      { observationId: '1', stance: 'mentioned_neutral', recommendedOver: [], losesTo: [], brandsNamed: ['Follow Up Boss'] },
    ];
    const v = buildVerdict([obs({ id: '1' })], stances, 'Acme');
    expect(v.counted.competitorStanding.find((c) => c.name === 'Follow Up Boss')?.coMentions).toBe(1);
  });
});

describe('buildVerdict — judged summary', () => {
  it('is null when no stances were judged', () => {
    const v = buildVerdict([obs({ id: '1' })], [], 'Acme');
    expect(v.judged).toBeNull();
  });

  it('counts stances and ranks losing/winning prompts', () => {
    const stances: VerdictStance[] = [
      { observationId: '1', stance: 'recommended_primary', recommendedOver: [], losesTo: [], brandsNamed: [] },
      { observationId: '2', stance: 'mentioned_negative', recommendedOver: [], losesTo: ['A', 'B'], brandsNamed: [] },
    ];
    const v = buildVerdict([obs({ id: '1', prompt: 'winning prompt' }), obs({ id: '2', prompt: 'losing prompt' })], stances, 'Acme');
    expect(v.judged!.stanceCounts.recommended_primary).toBe(1);
    expect(v.judged!.stanceCounts.mentioned_negative).toBe(1);
    expect(v.judged!.winningPrompts).toEqual([{ observationId: '1', prompt: 'winning prompt' }]);
    expect(v.judged!.losingPrompts).toEqual([{ observationId: '2', prompt: 'losing prompt', losesTo: ['A', 'B'] }]);
  });
});

describe('buildVerdict — headlines', () => {
  it('always includes the overall mention/citation headline', () => {
    const v = buildVerdict([obs({ id: '1', mentioned: true, cited: true })], [], 'Acme');
    expect(v.headlines[0]).toMatch(/Mentioned in 100%/);
  });

  it('flags uneven engines past the 5pp gap on unbranded observations', () => {
    const observations = [
      obs({ id: '1', surface: 'cloro_chatgpt', mentioned: true, branding: 'unbranded' }),
      obs({ id: '2', surface: 'cloro_chatgpt', mentioned: true, branding: 'unbranded' }),
      obs({ id: '3', surface: 'cloro_gemini', mentioned: false, branding: 'unbranded' }),
      obs({ id: '4', surface: 'cloro_gemini', mentioned: false, branding: 'unbranded' }),
    ];
    const v = buildVerdict(observations, [], 'Acme');
    expect(v.headlines.some((h) => h.includes('uneven'))).toBe(true);
  });

  it('calls engines consistent when within the 5pp gap', () => {
    const observations = [
      obs({ id: '1', surface: 'cloro_chatgpt', mentioned: true, branding: 'unbranded' }),
      obs({ id: '2', surface: 'cloro_gemini', mentioned: true, branding: 'unbranded' }),
    ];
    const v = buildVerdict(observations, [], 'Acme');
    expect(v.headlines.some((h) => h.includes('consistent'))).toBe(true);
  });

  it('names the most-lost-to rival when one exists', () => {
    const stances: VerdictStance[] = [{ observationId: '1', stance: 'mentioned_neutral', recommendedOver: [], losesTo: ['Big Rival'], brandsNamed: [] }];
    const v = buildVerdict([obs({ id: '1' })], stances, 'Acme');
    expect(v.headlines.some((h) => h.includes('Big Rival'))).toBe(true);
  });
});
