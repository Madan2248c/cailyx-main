import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetcherService } from '../../fetcher/fetcher.service.js';
import { findOrganization, isLiveCheckable, LiveVerifier } from './live.verifier.js';

const SITE = 'https://acme.test';

describe('LiveVerifier', () => {
  let fetch: ReturnType<typeof vi.fn>;
  let verifier: LiveVerifier;
  const respond = (status: number, body = '') => fetch.mockResolvedValue({ status, body });

  beforeEach(() => {
    fetch = vi.fn();
    verifier = new LiveVerifier({ fetch } as unknown as FetcherService);
  });

  it('always fetches fresh — never a cached copy', async () => {
    respond(200, 'User-agent: *\nAllow: /');
    await verifier.verify({ kind: 'robots-exists' }, SITE);
    expect(fetch).toHaveBeenCalledWith({ url: `${SITE}/robots.txt`, bypassCache: true, cacheTtlSeconds: 0 }, 'remediation');
  });

  it('robots-allows passes once the bots are unblocked, and names the ones still blocked', async () => {
    respond(200, 'User-agent: PerplexityBot\nDisallow: /\n');
    const fail = await verifier.verify({ kind: 'robots-allows', bots: ['PerplexityBot', 'OAI-SearchBot'] }, SITE);
    expect(fail.passed).toBe(false);
    expect(fail.observed).toBe('Still blocked at "/": PerplexityBot.');

    respond(200, 'User-agent: *\nAllow: /\n');
    expect((await verifier.verify({ kind: 'robots-allows', bots: ['PerplexityBot'] }, SITE)).passed).toBe(true);
  });

  it('robots-allows treats a network error as not verified', async () => {
    respond(0);
    expect((await verifier.verify({ kind: 'robots-allows', bots: ['PerplexityBot'] }, SITE)).passed).toBe(false);
  });

  it('robots-declares-sitemap', async () => {
    respond(200, 'User-agent: *\nAllow: /\nSitemap: https://acme.test/sitemap.xml');
    expect((await verifier.verify({ kind: 'robots-declares-sitemap' }, SITE)).passed).toBe(true);
  });

  it('json-ld-has finds Organization inside @graph and reports missing fields', async () => {
    const html = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":"Organization","name":"Acme","url":"https://acme.test","sameAs":[]}]}</script></head></html>`;
    respond(200, html);
    const r = await verifier.verify({ kind: 'json-ld-has', url: SITE, type: 'Organization', fields: ['name', 'sameAs'] }, SITE);
    expect(r.passed).toBe(false);
    expect(r.observed).toContain('sameAs');
  });

  it('page-issue-absent re-runs the audit rubric on the live page', async () => {
    respond(200, '<html><head><title>Pricing</title></head><body><h1>Pricing</h1></body></html>');
    const missing = await verifier.verify({ kind: 'page-issue-absent', url: `${SITE}/pricing`, issues: ['meta-missing'] }, SITE);
    expect(missing.passed).toBe(false);

    respond(200, '<html><head><title>Pricing</title><meta name="description" content="Plans and prices for Acme widgets, for small teams and growing companies alike."></head><body><h1>Pricing</h1></body></html>');
    const fixed = await verifier.verify({ kind: 'page-issue-absent', url: `${SITE}/pricing`, issues: ['meta-missing'] }, SITE);
    expect(fixed.passed).toBe(true);
  });

  it('finding-absent is not live-checkable', () => {
    expect(isLiveCheckable({ kind: 'finding-absent', module: 'technical-audit', findingRef: 'cwv' })).toBe(false);
    expect(isLiveCheckable({ kind: 'robots-exists' })).toBe(true);
  });

  it('findOrganization ignores invalid JSON-LD blocks', () => {
    expect(findOrganization('<script type="application/ld+json">{bad</script>')).toBeNull();
    expect(findOrganization('<script type="application/ld+json">{"@type":["LocalBusiness"],"name":"A"}</script>')).toMatchObject({ name: 'A' });
  });
});
