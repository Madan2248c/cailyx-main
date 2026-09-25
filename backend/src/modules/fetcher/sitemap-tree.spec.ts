import { describe, expect, it, vi } from 'vitest';
import type { FetcherService } from './fetcher.service.js';
import type { FetchResult } from './fetcher.types.js';
import { discoverSitemapTree, isSitemapFile, parseRobotsSitemaps, parseSitemapLocs, parseUrlset } from './sitemap-tree.js';

const ORIGIN = 'https://acme.com';

function sitemap(...entries: Array<string | { url: string; lastmod?: string }>): string {
  const items = entries.map((e) => (typeof e === 'string' ? { url: e } : e));
  return `<urlset>${items.map((e) => `<url><loc>${e.url}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`).join('')}</urlset>`;
}

function index(...children: string[]): string {
  return `<sitemapindex>${children.map((c) => `<sitemap><loc>${c}</loc></sitemap>`).join('')}</sitemapindex>`;
}

function fetchResult(url: string, status: number, body: string): FetchResult {
  return { url, finalUrl: url, status, statusText: 'OK', headers: {}, body, timing: { latencyMs: 1 }, userAgent: 'test', cached: false, retryCount: 0 };
}

/** A real, unbudgeted counter — behaves like a caller's actual budget class without depending on either module's own. */
function unboundedBudget() {
  let requests = 0;
  return { requestsLeft: () => Infinity, spendRequests: (n = 1) => void (requests += n), get spent() { return requests; } };
}

function fakeFetcher(site: Record<string, { status?: number; body: string }>): FetcherService {
  const fetch = vi.fn(async (opts: { url: string }) => {
    const entry = site[opts.url];
    if (!entry) throw new Error(`unexpected fetch: ${opts.url}`);
    return fetchResult(opts.url, entry.status ?? 200, entry.body);
  });
  return { fetch } as unknown as FetcherService;
}

const opts = { maxDepth: 4, maxFiles: 50, fallbackPaths: ['/sitemap.xml', '/sitemap_index.xml'], calledBy: 'test' };

describe('discoverSitemapTree', () => {
  it('reads every entry point robots.txt declares, not just the first that resolves', async () => {
    const site = {
      [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/first.xml\nSitemap: ${ORIGIN}/second.xml` },
      [`${ORIGIN}/first.xml`]: { body: sitemap(`${ORIGIN}/about`) },
      [`${ORIGIN}/second.xml`]: { body: sitemap(`${ORIGIN}/pricing`) },
    };
    const result = await discoverSitemapTree(fakeFetcher(site), ORIGIN, unboundedBudget(), 'run-1', opts);

    expect(result.entryPoints.map((e) => e.url)).toEqual([`${ORIGIN}/first.xml`, `${ORIGIN}/second.xml`]);
    expect(result.entryPoints.every((e) => e.resolved)).toBe(true);
    expect(result.entries.map((e) => e.url).sort()).toEqual([`${ORIGIN}/about`, `${ORIGIN}/pricing`].sort());
    expect(result.declaredInRobots).toBe(true);
  });

  it('falls back to conventional paths only when robots.txt names none', async () => {
    const site = {
      [`${ORIGIN}/robots.txt`]: { body: 'User-agent: *\nDisallow:' },
      [`${ORIGIN}/sitemap.xml`]: { body: sitemap(`${ORIGIN}/home`) },
    };
    const result = await discoverSitemapTree(fakeFetcher(site), ORIGIN, unboundedBudget(), 'run-1', opts);

    expect(result.declaredInRobots).toBe(false);
    expect(result.entryPoints.map((e) => e.url)).toEqual([`${ORIGIN}/sitemap.xml`, `${ORIGIN}/sitemap_index.xml`]);
    expect(result.entries.map((e) => e.url)).toEqual([`${ORIGIN}/home`]);
  });

  it('walks a sitemap index into its children and captures each page lastmod', async () => {
    const site = {
      [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/index.xml` },
      [`${ORIGIN}/index.xml`]: { body: index(`${ORIGIN}/pages.xml`, `${ORIGIN}/blog.xml`) },
      [`${ORIGIN}/pages.xml`]: { body: sitemap({ url: `${ORIGIN}/about`, lastmod: '2026-01-01' }) },
      [`${ORIGIN}/blog.xml`]: { body: sitemap({ url: `${ORIGIN}/blog/post-1`, lastmod: '2026-02-01' }) },
    };
    const result = await discoverSitemapTree(fakeFetcher(site), ORIGIN, unboundedBudget(), 'run-1', opts);

    expect(result.entryPoints[0]!.isIndex).toBe(true);
    const byUrl = new Map(result.entries.map((e) => [e.url, e.lastmod]));
    expect(byUrl.get(`${ORIGIN}/about`)).toBe(new Date('2026-01-01').toISOString());
    expect(byUrl.get(`${ORIGIN}/blog/post-1`)).toBe(new Date('2026-02-01').toISOString());
  });

  it('bounds a large index by maxFiles across the whole tree, not per entry point', async () => {
    const children = Array.from({ length: 40 }, (_, i) => `${ORIGIN}/child-${i}.xml`);
    const site: Record<string, { body: string }> = {
      [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/index.xml` },
      [`${ORIGIN}/index.xml`]: { body: index(...children) },
    };
    for (const [i, child] of children.entries()) site[child] = { body: sitemap(`${ORIGIN}/page-${i}`) };

    const result = await discoverSitemapTree(fakeFetcher(site), ORIGIN, unboundedBudget(), 'run-1', { ...opts, maxFiles: 10 });

    expect(result.entries.length).toBeLessThanOrEqual(10);
  });

  it('never spends more requests than the budget allows', async () => {
    const site = {
      [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/a.xml\nSitemap: ${ORIGIN}/b.xml` },
      [`${ORIGIN}/a.xml`]: { body: sitemap(`${ORIGIN}/a-page`) },
      [`${ORIGIN}/b.xml`]: { body: sitemap(`${ORIGIN}/b-page`) },
    };
    let spent = 0;
    const tightBudget = { requestsLeft: () => Math.max(0, 1 - spent), spendRequests: (n = 1) => void (spent += n) };

    const result = await discoverSitemapTree(fakeFetcher(site), ORIGIN, tightBudget, 'run-1', opts);

    // Only robots.txt fit in the budget — neither sitemap was fetched.
    expect(result.entries).toEqual([]);
    expect(result.entryPoints.every((e) => !e.resolved)).toBe(true);
  });

  it('reports an unresolved entry point without throwing on a 404 or network error', async () => {
    const fetcher = { fetch: vi.fn().mockRejectedValue(new Error('network down')) } as unknown as FetcherService;
    const result = await discoverSitemapTree(fetcher, ORIGIN, unboundedBudget(), 'run-1', opts);

    expect(result.entries).toEqual([]);
    expect(result.entryPoints.every((e) => !e.resolved)).toBe(true);
  });

  it('prefers a non-null lastmod when the same URL appears under two entry points', async () => {
    const site = {
      [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/first.xml\nSitemap: ${ORIGIN}/second.xml` },
      [`${ORIGIN}/first.xml`]: { body: sitemap(`${ORIGIN}/about`) }, // no lastmod
      [`${ORIGIN}/second.xml`]: { body: sitemap({ url: `${ORIGIN}/about`, lastmod: '2026-03-01' }) },
    };
    const result = await discoverSitemapTree(fakeFetcher(site), ORIGIN, unboundedBudget(), 'run-1', opts);

    const about = result.entries.find((e) => e.url === `${ORIGIN}/about`);
    expect(about?.lastmod).toBe(new Date('2026-03-01').toISOString());
  });
});

describe('parsing helpers', () => {
  it('parseSitemapLocs extracts every <loc>, index or urlset alike', () => {
    expect(parseSitemapLocs(sitemap('https://a.com/1', 'https://a.com/2'))).toEqual(['https://a.com/1', 'https://a.com/2']);
    expect(parseSitemapLocs(index('https://a.com/child.xml'))).toEqual(['https://a.com/child.xml']);
  });

  it('parseUrlset pairs each loc with its own lastmod, not a global one', () => {
    const body = sitemap({ url: 'https://a.com/1', lastmod: '2026-01-01' }, { url: 'https://a.com/2' });
    const entries = parseUrlset(body);
    expect(entries).toEqual([
      { url: 'https://a.com/1', lastmod: new Date('2026-01-01').toISOString() },
      { url: 'https://a.com/2', lastmod: null },
    ]);
  });

  it('parseUrlset returns nothing for a pure index document', () => {
    expect(parseUrlset(index('https://a.com/child.xml'))).toEqual([]);
  });

  it('parseRobotsSitemaps reads every Sitemap: line', () => {
    const body = 'User-agent: *\nSitemap: https://a.com/one.xml\nDisallow: /admin\nSitemap: https://a.com/two.xml';
    expect(parseRobotsSitemaps(body)).toEqual(['https://a.com/one.xml', 'https://a.com/two.xml']);
  });

  it('isSitemapFile recognizes .xml and .xml.gz, not a page URL', () => {
    expect(isSitemapFile('https://a.com/sitemap.xml')).toBe(true);
    expect(isSitemapFile('https://a.com/sitemap.xml.gz')).toBe(true);
    expect(isSitemapFile('https://a.com/about')).toBe(false);
  });
});
