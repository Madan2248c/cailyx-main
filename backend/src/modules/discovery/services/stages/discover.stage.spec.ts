import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MAX_SITEMAP_FILES } from '../../discovery.constants.js';
import { PrismaService } from '../../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../../test/mocks/prisma.mock.js';
import { FetcherService } from '../../../fetcher/fetcher.service.js';
import type { FetchResult, RenderResult } from '../../../fetcher/fetcher.types.js';
import { RunBudget, type DiscoveryRunContext } from '../pipeline-context.js';
import { DiscoverStage } from './discover.stage.js';

const ORIGIN = 'https://acme.com';
const RUN_ID = 'run-1';

/** One page the fake site serves. A missing entry throws, so a stray fetch is loud. */
interface SiteEntry {
  status?: number;
  html?: string;
  text?: string;
  title?: string;
  /** Raw body, for robots.txt and sitemap XML (read through `fetch`, not `render`). */
  body?: string;
}

function fetchResult(url: string, status: number, body: string): FetchResult {
  return {
    url,
    finalUrl: url,
    status,
    statusText: status === 200 ? 'OK' : 'Not Found',
    headers: {},
    body,
    timing: { latencyMs: 1 },
    userAgent: 'test',
    cached: false,
    retryCount: 0,
  };
}

function renderResult(url: string, entry: SiteEntry): RenderResult {
  return {
    url,
    finalUrl: url,
    html: entry.html ?? `<html><body>${entry.text ?? ''}</body></html>`,
    text: entry.text ?? '',
    title: entry.title ?? '',
    timing: { latencyMs: 1 },
    jsDisabled: false,
  };
}

function sitemap(...urls: string[]): string {
  return `<urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`;
}

describe('DiscoverStage', () => {
  let stage: DiscoverStage;
  let prisma: PrismaMock;
  let fetcher: { fetch: ReturnType<typeof vi.fn>; render: ReturnType<typeof vi.fn> };
  let site: Record<string, SiteEntry>;
  let notes: string[];
  let checkpoint: Mock<() => Promise<void>>;

  const limits = { maxPages: 12, maxRequests: 40, maxChars: 24_000, maxElapsedMs: 300_000, maxRetriesPerPage: 2 };

  function context(): DiscoveryRunContext {
    return {
      runId: RUN_ID,
      project: { id: 'project-1', name: 'Acme', domain: 'acme.com' },
      // A fresh copy: RunBudget holds the limits by reference, so a test that
      // narrows a budget would otherwise reconfigure every test after it.
      budget: new RunBudget({ pages: 0, requests: 0, chars: 0, elapsedMs: 0 }, { ...limits }),
      state: {},
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      note: vi.fn(async (text: string) => {
        notes.push(text);
      }),
      checkpoint,
    };
  }

  /** Wire the fake site into both fetcher entry points, keyed by URL. */
  function serve(): void {
    fetcher.fetch.mockImplementation(async (opts: { url: string }) => {
      const entry = site[opts.url];
      if (!entry) throw new Error(`unexpected fetch: ${opts.url}`);
      return fetchResult(opts.url, entry.status ?? 200, entry.body ?? '');
    });
    fetcher.render.mockImplementation(async (opts: { url: string }) => {
      const entry = site[opts.url];
      if (!entry) throw new Error(`unexpected render: ${opts.url}`);
      return renderResult(opts.url, entry);
    });
  }

  /**
   * The stage asks `count` twice — all usable pages, then the failed ones — so
   * the mock has to answer by query rather than with one fixed number.
   */
  function setCounts(usable: number, failed: number): void {
    prisma.discoveredPage.count.mockImplementation(async (args: { where?: { fetchStatus?: unknown } }) => {
      return args?.where?.fetchStatus === 'FAILED' ? failed : usable;
    });
  }

  /** The rows the stage actually wrote, in order. */
  function createdRows(): Array<Record<string, unknown>> {
    return prisma.discoveredPage.create.mock.calls.map((call) => (call[0] as { data: Record<string, unknown> }).data);
  }

  function fetchedUrls(mock: ReturnType<typeof vi.fn>): string[] {
    return mock.mock.calls.map((call) => (call[0] as { url: string }).url);
  }

  beforeEach(async () => {
    prisma = createPrismaMock();
    prisma.discoveredPage.findMany.mockResolvedValue([]);
    setCounts(0, 0);
    fetcher = { fetch: vi.fn(), render: vi.fn() };
    site = {};
    notes = [];
    checkpoint = vi.fn<() => Promise<void>>(async () => {});

    const moduleRef = await Test.createTestingModule({
      providers: [
        DiscoverStage,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: FetcherService, useValue: fetcher },
      ],
    }).compile();

    stage = moduleRef.get(DiscoverStage);
  });

  it('crawls the homepage, then the sitemap, recording classified pages', async () => {
    site = {
      [`${ORIGIN}/`]: { title: 'Acme', text: 'Acme does things.', html: '<html><body>Acme</body></html>' },
      [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/main-sitemap.xml` },
      [`${ORIGIN}/main-sitemap.xml`]: { body: sitemap(`${ORIGIN}/services`, `${ORIGIN}/pricing`) },
      [`${ORIGIN}/services`]: {
        title: 'Services',
        text: 'Tax planning and wealth management.',
        html: '<html><body><h2>Tax Planning</h2><h2>Wealth Management</h2></body></html>',
      },
      [`${ORIGIN}/pricing`]: { title: 'Pricing', text: 'Plans from £50.' },
    };
    serve();
    const ctx = context();

    await stage.run(ctx);

    // Order-independent: the sitemap's own ranking (high-signal first, then
    // shallower/shorter) decides the visit order, and that ordering is not what
    // this test is about.
    const byUrl = new Map(createdRows().map((row) => [row.url as string, row]));
    expect([...byUrl.keys()].sort()).toEqual([`${ORIGIN}/`, `${ORIGIN}/pricing`, `${ORIGIN}/services`].sort());
    expect(byUrl.get(`${ORIGIN}/`)!.pageType).toBe('HOMEPAGE');
    expect(byUrl.get(`${ORIGIN}/services`)!.pageType).toBe('SERVICE');
    expect(byUrl.get(`${ORIGIN}/pricing`)!.pageType).toBe('PRICING');
    expect(createdRows().every((row) => row.fetchStatus === 'FETCHED')).toBe(true);
    expect((byUrl.get(`${ORIGIN}/`)!.pipelineState as Record<string, unknown>).discoverySource).toBe('homepage');
    expect((byUrl.get(`${ORIGIN}/services`)!.pipelineState as Record<string, unknown>).discoverySource).toBe('sitemap');
    // Extract reads its candidates off the page row, so a fetched page must
    // carry them or the deterministic pass silently produces nothing.
    const servicesState = byUrl.get(`${ORIGIN}/services`)!.pipelineState as Record<string, unknown>;
    expect(servicesState.title).toBe('Services');
    expect(servicesState.serviceCandidates).toEqual(['Tax Planning', 'Wealth Management']);
    expect(checkpoint).toHaveBeenCalled();
  });

  it('takes the sitemap URL from robots.txt instead of guessing the common paths', async () => {
    site = {
      [`${ORIGIN}/`]: { title: 'Acme', text: 'Acme' },
      [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/my-sitemap.xml` },
      [`${ORIGIN}/my-sitemap.xml`]: { body: sitemap(`${ORIGIN}/about`) },
      [`${ORIGIN}/about`]: { title: 'About', text: 'We are Acme.' },
    };
    serve();

    await stage.run(context());

    const fetched = fetchedUrls(fetcher.fetch);
    expect(fetched).toContain(`${ORIGIN}/my-sitemap.xml`);
    expect(fetched).not.toContain(`${ORIGIN}/sitemap.xml`);
  });

  // Regression test for a real gap fixed when the sitemap-discovery logic
  // moved into the shared `fetcher/sitemap-tree.ts` (Technical Audit needs
  // full coverage, not just a representative sample): a site can legitimately
  // declare two `Sitemap:` lines for two disjoint sections, and both must be
  // read — stopping at the first one that resolves would silently drop
  // everything the second one names, which is wrong for any caller that
  // needs the whole site, and was already an honest bug even for Discovery's
  // narrower needs. See docs/analysis/technical-audit.md "Sitemap check".
  it('reads every declared sitemap entry point, not just the first that resolves', async () => {
    site = {
      [`${ORIGIN}/`]: { title: 'Acme', text: 'Acme' },
      [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/first.xml\nSitemap: ${ORIGIN}/second.xml` },
      [`${ORIGIN}/first.xml`]: { body: sitemap(`${ORIGIN}/about`) },
      [`${ORIGIN}/second.xml`]: { body: sitemap(`${ORIGIN}/pricing`) },
      [`${ORIGIN}/about`]: { title: 'About', text: 'We are Acme.' },
      [`${ORIGIN}/pricing`]: { title: 'Pricing', text: 'Plans and pricing.' },
    };
    serve();

    await stage.run(context());

    const fetched = fetchedUrls(fetcher.fetch);
    expect(fetched).toContain(`${ORIGIN}/first.xml`);
    expect(fetched).toContain(`${ORIGIN}/second.xml`);
    expect(fetched).toContain(`${ORIGIN}/about`);
    expect(fetched).toContain(`${ORIGIN}/pricing`);
  });

  it('walks a sitemap index into its children but caps how many files it reads', async () => {
    const children = Array.from({ length: 60 }, (_, i) => `${ORIGIN}/child-${i}.xml`);
    site = {
      [`${ORIGIN}/`]: { title: 'Acme', text: 'Acme' },
      [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/index.xml` },
      [`${ORIGIN}/index.xml`]: { body: sitemap(...children) },
    };
    for (const [i, child] of children.entries()) {
      site[child] = { body: sitemap(`${ORIGIN}/page-${i}`) };
    }
    serve();
    const ctx = context();

    await stage.run(ctx);

    const childReads = fetchedUrls(fetcher.fetch).filter((url) => /\/child-\d+\.xml$/.test(url));
    // The walk is bounded by MAX_SITEMAP_FILES — a huge index must not be read whole.
    expect(childReads.length).toBeGreaterThan(0);
    expect(childReads.length).toBeLessThanOrEqual(MAX_SITEMAP_FILES);
  });

  it('falls back to the homepage nav links when the site publishes no usable sitemap', async () => {
    site = {
      [`${ORIGIN}/`]: {
        title: 'Acme',
        text: 'Acme does things.',
        html: '<html><body><nav><a href="/services">Services</a><a href="/about">About</a></nav></body></html>',
      },
      [`${ORIGIN}/robots.txt`]: { status: 404 },
      [`${ORIGIN}/sitemap.xml`]: { status: 404 },
      [`${ORIGIN}/sitemap_index.xml`]: { status: 404 },
      [`${ORIGIN}/sitemap-index.xml`]: { status: 404 },
      [`${ORIGIN}/wp-sitemap.xml`]: { status: 404 },
      [`${ORIGIN}/sitemap/sitemap.xml`]: { status: 404 },
      [`${ORIGIN}/services`]: { title: 'Services', text: 'What we do.' },
      [`${ORIGIN}/about`]: { title: 'About', text: 'Who we are.' },
    };
    serve();

    await stage.run(context());

    const sources = createdRows().map((row) => (row.pipelineState as Record<string, unknown>).discoverySource);
    expect(sources).toEqual(['homepage', 'homepage-links', 'homepage-links']);
  });

  it('never exceeds the page budget', async () => {
    site = {
      [`${ORIGIN}/`]: { title: 'Acme', text: 'Acme' },
      [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/main-sitemap.xml` },
      [`${ORIGIN}/main-sitemap.xml`]: { body: sitemap(`${ORIGIN}/services`, `${ORIGIN}/pricing`) },
      [`${ORIGIN}/services`]: { title: 'Services', text: 'One.' },
      [`${ORIGIN}/pricing`]: { title: 'Pricing', text: 'Two.' },
    };
    serve();
    const ctx = context();
    // One page: the homepage fills it, so the sitemap must not even be read.
    (ctx.budget.limits as { maxPages: number }).maxPages = 1;

    await stage.run(ctx);

    expect(createdRows()).toHaveLength(1);
    expect(createdRows()[0]!.url).toBe(`${ORIGIN}/`);
    expect(ctx.budget.snapshot().pagesSpent).toBe(1);
    expect(fetchedUrls(fetcher.fetch)).not.toContain(`${ORIGIN}/robots.txt`);
  });

  it('never exceeds the request budget, and says so when discovery is cut short', async () => {
    site = {
      [`${ORIGIN}/`]: { title: 'Acme', text: 'Acme' },
      [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/main-sitemap.xml` },
      [`${ORIGIN}/main-sitemap.xml`]: { body: sitemap(`${ORIGIN}/services`) },
      [`${ORIGIN}/services`]: { title: 'Services', text: 'One.' },
    };
    serve();
    const ctx = context();
    // Homepage + robots.txt consume both requests.
    (ctx.budget.limits as { maxRequests: number }).maxRequests = 2;

    setCounts(1, 0);
    await stage.run(ctx);

    expect(ctx.budget.snapshot().requestsSpent).toBe(2);
    expect(createdRows().map((row) => row.url)).toEqual([`${ORIGIN}/`]);
    expect(notes.some((note) => note.includes('request budget'))).toBe(true);
  });

  it('records a page whose text duplicates one already read as nothing at all', async () => {
    const shared = 'The same document served under two paths, verbatim.';
    site = {
      [`${ORIGIN}/`]: { title: 'Acme', text: 'Acme homepage.' },
      [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/main-sitemap.xml` },
      [`${ORIGIN}/main-sitemap.xml`]: { body: sitemap(`${ORIGIN}/a`, `${ORIGIN}/b`) },
      [`${ORIGIN}/a`]: { title: 'A', text: shared },
      [`${ORIGIN}/b`]: { title: 'B', text: shared },
    };
    serve();

    await stage.run(context());

    expect(createdRows().map((row) => row.url)).toEqual([`${ORIGIN}/`, `${ORIGIN}/a`]);
  });

  it('skips a soft-404 homepage and reports it rather than storing an error page', async () => {
    site = {
      [`${ORIGIN}/`]: { title: '404 - Page not found', text: 'Nothing here.' },
      [`${ORIGIN}/robots.txt`]: { status: 404 },
    };
    serve();

    await stage.run(context());

    // Not stored as a usable page — but the spent request is accounted for.
    expect(createdRows().some((row) => row.fetchStatus === 'FETCHED')).toBe(false);
    expect(createdRows()).toHaveLength(1);
    expect(createdRows()[0]!.fetchStatus).toBe('FAILED');
    expect(createdRows()[0]!.url).toBe(`${ORIGIN}/`);
    expect(notes.some((note) => note.includes('no reachable pages'))).toBe(true);
  });

  it('records a dead candidate as FAILED so its spent request stays accounted for', async () => {
    site = {
      [`${ORIGIN}/`]: { title: 'Acme', text: 'Acme' },
      [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/main-sitemap.xml` },
      [`${ORIGIN}/main-sitemap.xml`]: { body: sitemap(`${ORIGIN}/gone`) },
      [`${ORIGIN}/gone`]: { status: 500 },
    };
    serve();

    await stage.run(context());

    const failed = createdRows().filter((row) => row.fetchStatus === 'FAILED');
    expect(failed.map((row) => row.url)).toEqual([`${ORIGIN}/gone`]);
  });

  it('does not re-fetch a page already recorded, so a resumed run makes no repeat requests', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([
      {
        id: 'page-home',
        url: `${ORIGIN}/`,
        contentHash: '1:10',
        pipelineState: {},
        createdAt: new Date(),
      },
    ]);
    site = {
      [`${ORIGIN}/robots.txt`]: { status: 404 },
      [`${ORIGIN}/sitemap.xml`]: { status: 404 },
      [`${ORIGIN}/sitemap_index.xml`]: { status: 404 },
      [`${ORIGIN}/sitemap-index.xml`]: { status: 404 },
      [`${ORIGIN}/wp-sitemap.xml`]: { status: 404 },
      [`${ORIGIN}/sitemap/sitemap.xml`]: { status: 404 },
    };
    serve();

    await stage.run(context());

    expect(fetchedUrls(fetcher.render)).not.toContain(`${ORIGIN}/`);
    expect(createdRows()).toEqual([]);
  });
});
