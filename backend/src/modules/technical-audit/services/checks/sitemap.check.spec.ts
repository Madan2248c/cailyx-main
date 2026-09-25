import { describe, expect, it, vi } from 'vitest';
import type { AuditContext } from '../audit-context.js';
import { SitemapCheck } from './sitemap.check.js';

const ORIGIN = 'https://acme.com';
const CTX: AuditContext = { runId: 'run-1', project: { id: 'p1', name: 'Acme', domain: 'acme.com' }, targetUrl: `${ORIGIN}/` };

function sitemap(...entries: Array<string | { url: string; lastmod?: string }>): string {
  const items = entries.map((e) => (typeof e === 'string' ? { url: e } : e));
  return `<urlset>${items.map((e) => `<url><loc>${e.url}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`).join('')}</urlset>`;
}

function fetchResult(url: string, status: number, body: string) {
  return { url, finalUrl: url, status, statusText: 'OK', headers: {}, body, timing: { latencyMs: 1 }, userAgent: 'test', cached: false, retryCount: 0 };
}

function fakeFetcher(site: Record<string, { status?: number; body: string }>) {
  const fetch = vi.fn(async (opts: { url: string }) => {
    const entry = site[opts.url];
    if (!entry) throw new Error(`unexpected fetch: ${opts.url}`);
    return fetchResult(opts.url, entry.status ?? 200, entry.body);
  });
  return { fetch } as unknown as import('../../../fetcher/fetcher.service.js').FetcherService;
}

describe('SitemapCheck', () => {
  it('fails with medium severity when no sitemap is found at all', async () => {
    const site = { [`${ORIGIN}/robots.txt`]: { status: 404, body: '' } };
    const check = new SitemapCheck(fakeFetcher(site));

    const result = await check.run(CTX);

    expect(result.status).toBe('fail');
    expect(result.severity).toBe('medium');
    expect((result.detail as { found: boolean }).found).toBe(false);
    expect(result.entries).toEqual([]);
  });

  it('passes and reports every declared entry point when multiple sitemaps are found fresh', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const site = {
      [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/pages.xml\nSitemap: ${ORIGIN}/blog.xml` },
      [`${ORIGIN}/pages.xml`]: { body: sitemap({ url: `${ORIGIN}/about`, lastmod: today }) },
      [`${ORIGIN}/blog.xml`]: { body: sitemap({ url: `${ORIGIN}/blog/post-1`, lastmod: today }) },
    };
    const check = new SitemapCheck(fakeFetcher(site));

    const result = await check.run(CTX);

    expect(result.status).toBe('pass');
    const detail = result.detail as { sitemapUrls: string[]; urlCount: number; declaredInRobots: boolean };
    expect(detail.sitemapUrls.sort()).toEqual([`${ORIGIN}/blog.xml`, `${ORIGIN}/pages.xml`].sort());
    expect(detail.urlCount).toBe(2);
    expect(detail.declaredInRobots).toBe(true);
    expect(result.entries).toHaveLength(2);
  });

  it('flags staleness past the freshness bar without calling it "not found"', async () => {
    const twoHundredDaysAgo = new Date(Date.now() - 200 * 86_400_000).toISOString();
    const site = {
      [`${ORIGIN}/robots.txt`]: { status: 404, body: '' },
      [`${ORIGIN}/sitemap.xml`]: { body: sitemap({ url: `${ORIGIN}/about`, lastmod: twoHundredDaysAgo }) },
    };
    const check = new SitemapCheck(fakeFetcher(site));

    const result = await check.run(CTX);

    expect(result.status).toBe('fail');
    expect(result.severity).toBe('low');
    const detail = result.detail as { found: boolean; staleDays: number };
    expect(detail.found).toBe(true);
    expect(detail.staleDays).toBeGreaterThan(90);
    expect(result.recommendedFix).toContain('days old');
  });

  it('computes offOriginCount for entries pointing at another host', async () => {
    const site = {
      [`${ORIGIN}/robots.txt`]: { status: 404, body: '' },
      [`${ORIGIN}/sitemap.xml`]: { body: sitemap(`${ORIGIN}/about`, 'https://other.com/page') },
    };
    const check = new SitemapCheck(fakeFetcher(site));

    const result = await check.run(CTX);

    expect((result.detail as { offOriginCount: number }).offOriginCount).toBe(1);
  });

  it('reports isIndex true when a resolved entry point is a sitemap index', async () => {
    const site = {
      [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/index.xml` },
      [`${ORIGIN}/index.xml`]: { body: `<sitemapindex><sitemap><loc>${ORIGIN}/children.xml</loc></sitemap></sitemapindex>` },
      [`${ORIGIN}/children.xml`]: { body: sitemap(`${ORIGIN}/about`) },
    };
    const check = new SitemapCheck(fakeFetcher(site));

    const result = await check.run(CTX);

    expect((result.detail as { isIndex: boolean }).isIndex).toBe(true);
  });
});
