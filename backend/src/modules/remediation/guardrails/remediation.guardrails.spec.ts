import { describe, expect, it } from 'vitest';
import { robotsHandler, schemaHandler } from '../handlers/technical.handlers.js';
import { promptTarget } from '../handlers/presence.handlers.js';
import type { FixSpecDraft } from '../remediation.types.js';
import { AEO_RUN, page, SA_RUN, SITE, snapshot, TA_RUN } from '../testing/snapshot.fixture.js';
import { applyGuardrails, coverageOf } from './remediation.guardrails.js';

function draft(overrides: Partial<FixSpecDraft> = {}): FixSpecDraft {
  return {
    problemKey: 'x.test',
    target: SITE,
    fixClass: 'CODE',
    method: 'INSTRUCTIONS',
    groupKey: 'x',
    severity: 'LOW',
    effort: 'LOW',
    title: 'Test',
    evidence: {},
    sources: [{ module: 'technical-audit', runId: TA_RUN, findingRef: 'robots' }],
    steps: ['Do it.'],
    acceptance: { kind: 'finding-absent', module: 'technical-audit', findingRef: 'robots' },
    ...overrides,
  };
}

describe('applyGuardrails', () => {
  it('keeps grounded drafts from the real handlers untouched', async () => {
    const s = snapshot();
    const drafts = [...robotsHandler.detect(s), ...schemaHandler.detect(s)];
    const { kept, dropped } = await applyGuardrails(drafts, s);
    expect(dropped).toEqual([]);
    expect(kept.map((k) => k.artifact !== undefined)).toEqual(drafts.map((d) => d.artifact !== undefined));
  });

  it('drops a draft citing a finding that is not in the collected data', async () => {
    const { kept, dropped } = await applyGuardrails([draft({ sources: [{ module: 'technical-audit', runId: TA_RUN, findingRef: 'made-up' }] })], snapshot());
    expect(kept).toEqual([]);
    expect(dropped[0].reason).toMatch(/ungrounded/);
  });

  it('drops a draft citing an older run of a real check', async () => {
    const { dropped } = await applyGuardrails([draft({ sources: [{ module: 'technical-audit', runId: 'old-run', findingRef: 'robots' }] })], snapshot());
    expect(dropped).toHaveLength(1);
  });

  it('drops a draft with no steps', async () => {
    const { dropped } = await applyGuardrails([draft({ steps: [' '] })], snapshot());
    expect(dropped[0].reason).toMatch(/steps/);
  });

  it('removes JSON-LD that does not parse, falling back to instructions with the reason', async () => {
    const bad = draft({ method: 'GENERATED', artifact: { kind: 'json-ld', language: 'html', content: '<script type="application/ld+json">{nope</script>' } });
    const { kept } = await applyGuardrails([bad], snapshot());
    expect(kept[0].artifact).toBeUndefined();
    expect(kept[0].method).toBe('INSTRUCTIONS');
    expect(kept[0].artifactError).toMatch(/does not parse/);
  });

  it('removes a robots.txt that would still block a bot it claims to unblock', async () => {
    const bad = draft({
      method: 'GENERATED',
      artifact: { kind: 'file', path: '/robots.txt', language: 'text', content: 'User-agent: *\nDisallow: /\n' },
      acceptance: { kind: 'robots-allows', bots: ['PerplexityBot'] },
    });
    const { kept } = await applyGuardrails([bad], snapshot());
    expect(kept[0].artifact).toBeUndefined();
    expect(kept[0].artifactError).toMatch(/still be blocked/);
  });
});

describe('coverageOf', () => {
  const s = snapshot();

  it('a check that ran counts as a newer look', () => {
    expect(coverageOf({ problemKey: 'robots.missing', target: SITE, sources: [{ module: 'technical-audit', findingRef: 'robots' }] }, s)).toEqual(s.technicalAudit!.completedAt);
  });

  it('a check that errored is not evidence of a fix', () => {
    const errored = snapshot();
    errored.technicalAudit!.findings[0].status = 'error';
    expect(coverageOf({ problemKey: 'robots.missing', target: SITE, sources: [{ module: 'technical-audit', findingRef: 'robots' }] }, errored)).toBeNull();
  });

  it('a per-page spec needs that page crawled this time', () => {
    const src = [{ module: 'technical-audit', findingRef: 'page-inventory' }];
    expect(coverageOf({ problemKey: 'page.meta-missing', target: `${SITE}/pricing`, sources: src }, s)).not.toBeNull();
    expect(coverageOf({ problemKey: 'page.meta-missing', target: `${SITE}/not-crawled`, sources: src }, s)).toBeNull();
    const more = snapshot();
    more.technicalAudit!.pages.push(page(`${SITE}/not-crawled`, []));
    expect(coverageOf({ problemKey: 'page.meta-missing', target: `${SITE}/not-crawled`, sources: src }, more)).not.toBeNull();
  });

  it('a social spec needs the platform evaluated (pass or fail)', () => {
    expect(coverageOf({ problemKey: 'social.dormant-platform', target: 'social:x', sources: [{ module: 'social-activity', findingRef: 'x:dormant-platform' }] }, s)).not.toBeNull();
    expect(coverageOf({ problemKey: 'social.dormant-platform', target: 'social:tiktok', sources: [{ module: 'social-activity', findingRef: 'tiktok:dormant-platform' }] }, s)).toBeNull();
    void SA_RUN;
  });

  it('an AEO spec is only settled when the prompt is now won — absence alone proves nothing', () => {
    const target = promptTarget('Best widget tool for small teams');
    const src = [{ module: 'aeo-audit', findingRef: 'losing-prompt:whatever' }];
    expect(coverageOf({ problemKey: 'aeo.losing-prompt', target, sources: src }, snapshot({ aeoAudit: { ...s.aeoAudit!, losingPrompts: [] } }))).toBeNull();
    const won = snapshot({ aeoAudit: { ...s.aeoAudit!, losingPrompts: [], winningPrompts: ['Best widget tool for small teams'] } });
    expect(coverageOf({ problemKey: 'aeo.losing-prompt', target, sources: src }, won)).toEqual(won.aeoAudit!.completedAt);
    void AEO_RUN;
  });
});
