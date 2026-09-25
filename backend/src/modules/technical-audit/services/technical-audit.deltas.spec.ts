import { describe, expect, it } from 'vitest';
import { buildComparison, comparePages, computeDeltas, METRICS, type ComparableRun } from './technical-audit.deltas.js';

function run(overrides: Partial<ComparableRun> = {}): ComparableRun {
  return { id: 'run-1', createdAt: '2026-01-01T00:00:00Z', score: 80, findings: [], pages: [], ...overrides };
}

describe('computeDeltas', () => {
  it('reports improved/regressed correctly for both higher-is-better and lower-is-better metrics', () => {
    const current = run({ score: 90 });
    const previous = run({ id: 'run-0', score: 70 });

    const deltas = computeDeltas(current, previous);
    const composite = deltas.find((d) => d.metric === 'composite')!;
    expect(composite.direction).toBe('improved');
    expect(composite.change).toBe(20);

    const curFailing = run({
      score: 90,
      findings: [{ type: 'robots', status: 'fail', severity: 'high', detail: {} }],
    });
    const prevFailing = run({ id: 'run-0', score: 70, findings: [] });
    const failingDelta = computeDeltas(curFailing, prevFailing).find((d) => d.metric === 'openFailures')!;
    // openFailures is lower-is-better: 0 -> 1 is a regression, not an improvement.
    expect(failingDelta.direction).toBe('regressed');
  });

  it('reports "new" when there is no previous run, and "unchanged" when the current value is null', () => {
    const current = run({ score: 80 });
    const noPrevious = computeDeltas(current, null).find((d) => d.metric === 'composite')!;
    expect(noPrevious.direction).toBe('new');
    expect(noPrevious.previous).toBeNull();

    const currentNoScore = run({ score: null });
    const previous = run({ id: 'run-0', score: 80 });
    const nullCurrent = computeDeltas(currentNoScore, previous).find((d) => d.metric === 'composite')!;
    expect(nullCurrent.direction).toBe('unchanged');
  });

  it('drops a metric entirely when neither run has a value for it', () => {
    // Neither run has a 'cwv' finding, so lcp/cls/inp/lighthouse* should be absent.
    const deltas = computeDeltas(run(), run({ id: 'run-0' }));
    expect(deltas.find((d) => d.metric === 'lcp')).toBeUndefined();
    expect(deltas.find((d) => d.metric === 'lighthousePerformance')).toBeUndefined();
  });

  it('reads every finding-derived metric via its detail blob, defensively', () => {
    const current = run({
      score: 85,
      findings: [
        { type: 'cwv', status: 'pass', severity: 'low', detail: { categories: { performance: 92, seo: 88, accessibility: 95 }, lcp: 1800, cls: 0.05, inp: 150 } },
        { type: 'sitemap', status: 'pass', severity: 'low', detail: { urlCount: 42, staleDays: 3 } },
        { type: 'page-inventory', status: 'pass', severity: 'low', detail: { averageScore: 77 } },
        { type: 'agent-readiness', status: 'pass', severity: 'low', detail: { score: 90 } },
        { type: 'cdn-inferred', status: 'pass', severity: 'low', detail: { blockedBots: ['GPTBot', 'ClaudeBot'] } },
      ],
    });
    const deltas = computeDeltas(current, null);
    const byMetric = Object.fromEntries(deltas.map((d) => [d.metric, d.current]));
    expect(byMetric.lighthousePerformance).toBe(92);
    expect(byMetric.lighthouseSeo).toBe(88);
    expect(byMetric.lighthouseAccessibility).toBe(95);
    expect(byMetric.lcp).toBe(1800);
    expect(byMetric.cls).toBe(0.05);
    expect(byMetric.inp).toBe(150);
    expect(byMetric.sitemapUrls).toBe(42);
    expect(byMetric.sitemapStaleDays).toBe(3);
    expect(byMetric.pageAverageScore).toBe(77);
    expect(byMetric.agentReadiness).toBe(90);
    expect(byMetric.blockedBots).toBe(2);
  });

  it('counts pages with any of a metric’s issue codes, not just an exact single code', () => {
    const current = run({
      pages: [
        { url: 'https://a.com/1', score: 60, issues: ['title-missing'] },
        { url: 'https://a.com/2', score: 70, issues: ['title-too-long'] },
        { url: 'https://a.com/3', score: 80, issues: [] },
      ],
    });
    const deltas = computeDeltas(current, null);
    expect(deltas.find((d) => d.metric === 'pagesBadTitle')?.current).toBe(2);
  });

  it('does not silently misread a mismatched detail shape as a value', () => {
    // A finding whose detail doesn't have the expected field at all.
    const current = run({ findings: [{ type: 'cwv', status: 'error', severity: 'low', detail: { error: 'PSI_API_KEY not configured' } }] });
    const deltas = computeDeltas(current, null);
    expect(deltas.find((d) => d.metric === 'lcp')).toBeUndefined();
  });

  it('exposes the metric registry with every documented key', () => {
    const keys = METRICS.map((m) => m.key).sort();
    expect(keys).toEqual(
      [
        'agentReadiness',
        'blockedBots',
        'composite',
        'lcp',
        'cls',
        'inp',
        'lighthouseAccessibility',
        'lighthousePerformance',
        'lighthouseSeo',
        'openFailures',
        'pageAverageScore',
        'pagesBadMeta',
        'pagesBadTitle',
        'pagesWithoutJsonLd',
        'sitemapStaleDays',
        'sitemapUrls',
      ].sort(),
    );
  });
});

describe('comparePages', () => {
  it('splits pages into added/removed/improved/regressed by URL', () => {
    const current = run({
      pages: [
        { url: 'https://a.com/kept-better', score: 90, issues: [] },
        { url: 'https://a.com/kept-worse', score: 40, issues: [] },
        { url: 'https://a.com/new', score: 80, issues: [] },
      ],
    });
    const previous = run({
      id: 'run-0',
      pages: [
        { url: 'https://a.com/kept-better', score: 60, issues: [] },
        { url: 'https://a.com/kept-worse', score: 70, issues: [] },
        { url: 'https://a.com/gone', score: 50, issues: [] },
      ],
    });

    const changes = comparePages(current, previous);
    expect(changes.added).toEqual(['https://a.com/new']);
    expect(changes.removed).toEqual(['https://a.com/gone']);
    expect(changes.improved).toEqual([{ url: 'https://a.com/kept-better', from: 60, to: 90 }]);
    expect(changes.regressed).toEqual([{ url: 'https://a.com/kept-worse', from: 70, to: 40 }]);
  });

  it('treats no previous run as everything added', () => {
    const current = run({ pages: [{ url: 'https://a.com/1', score: 80, issues: [] }] });
    const changes = comparePages(current, null);
    expect(changes.added).toEqual(['https://a.com/1']);
    expect(changes.removed).toEqual([]);
  });

  it('sorts swings by magnitude, biggest first', () => {
    const current = run({
      pages: [
        { url: 'https://a.com/small', score: 71, issues: [] },
        { url: 'https://a.com/big', score: 20, issues: [] },
      ],
    });
    const previous = run({
      id: 'run-0',
      pages: [
        { url: 'https://a.com/small', score: 70, issues: [] },
        { url: 'https://a.com/big', score: 90, issues: [] },
      ],
    });
    const changes = comparePages(current, previous);
    expect(changes.regressed[0]?.url).toBe('https://a.com/big');
  });
});

describe('buildComparison', () => {
  it('assembles the full comparison from the two pure pieces', () => {
    const current = run({ id: 'run-2', createdAt: '2026-02-01T00:00:00Z', score: 90 });
    const previous = run({ id: 'run-1', createdAt: '2026-01-01T00:00:00Z', score: 70 });

    const comparison = buildComparison(current, previous);
    expect(comparison.currentAuditId).toBe('run-2');
    expect(comparison.previousAuditId).toBe('run-1');
    expect(comparison.deltas.find((d) => d.metric === 'composite')?.direction).toBe('improved');
  });

  it('handles a first-ever run with no previous', () => {
    const current = run();
    const comparison = buildComparison(current, null);
    expect(comparison.previousAuditId).toBeNull();
    expect(comparison.previousAt).toBeNull();
  });
});
