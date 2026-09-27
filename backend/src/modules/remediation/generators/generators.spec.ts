import { describe, expect, it } from 'vitest';
import { getBotByName } from '../../fetcher/fetcher.constants.js';
import { ROBOTS_BLOCKING, SITE } from '../testing/snapshot.fixture.js';
import { canonicalTag, jsonLdBody, llmsTxt, organizationJsonLd } from './markup.generator.js';
import { robotsRootVerdicts } from './robots-verdict.js';
import { newRobotsTxt, unblockBots } from './robots-txt.generator.js';

const ua = (name: string) => getBotByName(name)!.userAgent;

describe('robots-txt generator', () => {
  it('unblocks the named bots at "/" — checked with the real RobotsService matcher', async () => {
    const before = await robotsRootVerdicts(ROBOTS_BLOCKING, [ua('OAI-SearchBot'), ua('PerplexityBot')]);
    expect([...before.values()]).toEqual([false, false]);

    const { content } = unblockBots(ROBOTS_BLOCKING, ['OAI-SearchBot', 'PerplexityBot'], { truncated: false });
    const after = await robotsRootVerdicts(content!, [ua('OAI-SearchBot'), ua('PerplexityBot')]);
    expect([...after.values()]).toEqual([true, true]);
  });

  it('leaves bots it was not asked about exactly as they were', async () => {
    const { content } = unblockBots(ROBOTS_BLOCKING, ['OAI-SearchBot'], { truncated: false });
    const verdicts = await robotsRootVerdicts(content!, [ua('GPTBot'), ua('PerplexityBot')]);
    expect(verdicts.get(ua('GPTBot'))).toBe(false);
    expect(verdicts.get(ua('PerplexityBot'))).toBe(false);
    expect(content).toContain(ROBOTS_BLOCKING.trim());
  });

  it('carries over non-root rules a bot already had, so access is not widened', async () => {
    const existing = 'User-agent: *\nDisallow: /\nDisallow: /admin\n';
    const { content } = unblockBots(existing, ['PerplexityBot'], { truncated: false });
    expect(content).toContain('Disallow: /admin');
    expect(content!.split('\n').filter((l) => l === 'Disallow: /').length).toBe(1); // only the original line
  });

  it('refuses to rewrite a truncated stored copy', () => {
    const r = unblockBots(ROBOTS_BLOCKING, ['OAI-SearchBot'], { truncated: true });
    expect(r.content).toBeNull();
    expect(r.error).toMatch(/truncated/);
  });

  it('a new robots.txt allows everyone and declares the sitemap', async () => {
    const txt = newRobotsTxt(`${SITE}/sitemap.xml`);
    expect(txt).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    const v = await robotsRootVerdicts(txt, [ua('GPTBot'), ua('PerplexityBot')]);
    expect([...v.values()].every(Boolean)).toBe(true);
  });
});

describe('markup generators', () => {
  const facts = { name: 'Acme', url: SITE, description: 'Acme makes widgets.', logoUrl: null, sameAs: ['https://x.com/acme'], offerings: ['Widget Cloud'] };

  it('builds parseable Organization JSON-LD and reports what it could not fill', () => {
    const r = organizationJsonLd(facts);
    const doc = JSON.parse(jsonLdBody(r.snippet!));
    expect(doc).toMatchObject({ '@type': 'Organization', name: 'Acme', url: SITE, sameAs: ['https://x.com/acme'] });
    expect(doc.logo).toBeUndefined();
    expect(r.missing).toEqual(['logo']);
  });

  it('generates nothing without a confirmed name — never guesses', () => {
    expect(organizationJsonLd({ ...facts, name: null }).snippet).toBeNull();
  });

  it('escapes the canonical URL', () => {
    expect(canonicalTag('https://acme.test/a?b="c"')).toBe('<link rel="canonical" href="https://acme.test/a?b=&quot;c&quot;" />');
  });

  it('llms.txt lists the name, summary and healthy pages only', () => {
    const txt = llmsTxt(facts, [
      { url: `${SITE}/pricing`, statusCode: 200, score: 90, issues: [], signals: { title: 'Pricing' } },
      { url: `${SITE}/broken`, statusCode: 404, score: 0, issues: ['page-error'], signals: { title: 'Gone' } },
    ])!;
    expect(txt.startsWith('# Acme\n')).toBe(true);
    expect(txt).toContain('> Acme makes widgets.');
    expect(txt).toContain(`[Pricing](${SITE}/pricing)`);
    expect(txt).not.toContain('broken');
  });
});
