import { Injectable, Logger } from '@nestjs/common';
import {
  DISCOVERY_URL_CAP,
  HIGH_SIGNAL_PATHS,
  HIGH_SIGNAL_PATTERNS,
  MAX_SITEMAP_DEPTH,
  MAX_SITEMAP_FILES,
  SAMPLES_PER_TEMPLATE,
  SITEMAP_ENTRY_POINTS,
} from '../../discovery.constants.js';
import { PAGE_TYPE_TO_PRISMA } from '../../discovery.types.js';
import type { DiscoveryRunContext } from '../pipeline-context.js';
import {
  allInternalLinks,
  classifyPageType,
  classificationConfidenceFor,
  fingerprint,
  internalNavLinks,
  isHomepageUrl,
  isSitemapFile,
  looksLike404,
  originOf,
  parseRobotsSitemaps,
  parseSitemapLocs,
  urlKey,
  asJson,
} from '../pipeline-utils.js';
import { readPageSignals } from './inspect.stage.js';
import { PrismaService } from '../../../../prisma/prisma.service.js';
import { FetcherService } from '../../../fetcher/fetcher.service.js';

/**
 * Discover — the crawl.
 *
 * Homepage first, then the site's real URL source (§1 sitemap/robots.txt),
 * falling back to the homepage's own nav/body links (§2) and only then to a
 * fixed list of guessed paths (§3). Every fetch is counted against the run's
 * page and request budgets, and a page is only recorded once it produced usable
 * content — a catch-all route serving the same document under many paths is
 * caught by content fingerprint, not by URL shape.
 *
 * Ported from the old `stageDiscover` + `sitemapCandidates` with persistence
 * adapted to `discovered_pages` and budgets read from `ctx.budget`. One
 * deliberate addition: a visit that gets a *definitive* bad answer — the server
 * returned a non-2xx status, or served a soft-404 — is recorded as a `FAILED`
 * row, so the request budget spent on it is visible instead of vanishing into
 * the gap between `requestsSpent` and the number of pages fetched. A visit that
 * failed *transiently* (a thrown network error, a timeout, an empty render)
 * records nothing, so a resumed run retries it — the old code's behaviour, and
 * the right one: seconds later the same URL often answers fine.
 */
@Injectable()
export class DiscoverStage {
  private readonly logger = new Logger(DiscoverStage.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fetcher: FetcherService,
  ) {}

  async run(ctx: DiscoveryRunContext): Promise<void> {
    const origin = originOf(ctx.project.domain);
    const existing = await this.prisma.discoveredPage.findMany({ where: { discoveryRunId: ctx.runId } });
    const seen = new Set(existing.map((p) => urlKey(p.url)));
    const fingerprints = new Set(existing.filter((p) => p.contentHash).map((p) => p.contentHash!));

    /** Records a definitive failure so spent requests are accounted for. */
    const recordFailed = async (url: string, statusCode: number | null, source: string): Promise<void> => {
      const isHome = isHomepageUrl(url, origin);
      const pageType = classifyPageType(url, isHome);
      const data = {
        fetchStatus: 'FAILED' as const,
        statusCode,
        discoverySource: source,
        fetchedAt: new Date().toISOString(),
      };
      const row = existing.find((p) => urlKey(p.url) === urlKey(url));
      if (row) {
        await this.prisma.discoveredPage.update({
          where: { id: row.id },
          data: {
            fetchStatus: 'FAILED',
            pipelineState: asJson({ ...(row.pipelineState as object), ...data }),
          },
        });
        return;
      }
      await this.prisma.discoveredPage.create({
        data: {
          projectId: ctx.project.id,
          discoveryRunId: ctx.runId,
          url,
          pageType: PAGE_TYPE_TO_PRISMA[pageType],
          classificationConfidence: classificationConfidenceFor(pageType),
          fetchStatus: 'FAILED',
          pipelineState: asJson(data),
        },
      });
    };

    /**
     * Fetch one candidate and record it.
     *
     * @returns the fetched page's HTML, or null when nothing usable came back —
     *   the caller keeps the HTML for its own use (the homepage's links), which
     *   is also why this returns it rather than re-reading the row: this module
     *   does not store raw HTML.
     */
    const visit = async (url: string, source: string): Promise<string | null> => {
      const key = urlKey(url);
      if (seen.has(key) || !ctx.budget.budgetLeft()) return null;
      seen.add(key);
      ctx.budget.spendRequests(1);
      try {
        // The headless-browser render path has no real HTTP status on its result type,
        // so a plain fetch first is what actually tells a live page from a dead link —
        // including soft-404s that return 200 with an "not found"-shaped body.
        const statusCheck = await this.fetcher.fetch({ url, timeout: 15000 }, 'discovery-check', ctx.runId).catch(() => null);
        if (statusCheck && (statusCheck.status < 200 || statusCheck.status >= 400)) {
          this.logger.debug(`Discovery skipped ${url}: HTTP ${statusCheck.status}`);
          await recordFailed(url, statusCheck.status, source);
          return null;
        }

        const res = await this.fetcher.render({ url, jsDisabled: false, timeout: 30000 }, 'discovery', ctx.runId);
        if (!res.html) {
          // An empty render is usually a block or a timeout on our side, not a
          // verdict about the URL — treat it like a throw so a resumed run retries it.
          this.logger.warn(`Discovery render returned no HTML for ${url} (source: ${source})`);
          return null;
        }
        if (looksLike404(res.title, res.text)) {
          this.logger.debug(`Discovery skipped ${url}: looks like a 404/error page ("${res.title}")`);
          await recordFailed(url, statusCheck?.status ?? 200, source);
          return null;
        }
        const fp = fingerprint(res.text || res.html);
        if (fingerprints.has(fp)) {
          this.logger.debug('Discovery skipped ' + url + ': same content as a page already read');
          return null;
        }
        fingerprints.add(fp);

        // Classification is a pure function of the URL, so it happens here while
        // the page is being recorded rather than as a second pass — see
        // pipeline-utils.classifyPageType. Tags/metadata come from the same fetch.
        const isHome = isHomepageUrl(url, origin);
        const pageType = classifyPageType(url, isHome);
        const signals = readPageSignals(res.html, res.text, res.title);

        await this.prisma.discoveredPage.create({
          data: {
            projectId: ctx.project.id,
            discoveryRunId: ctx.runId,
            url,
            pageType: PAGE_TYPE_TO_PRISMA[pageType],
            classificationConfidence: classificationConfidenceFor(pageType),
            fetchStatus: 'FETCHED',
            cleanedText: signals.cleanedText,
            jsonLdRaw: signals.jsonLdRaw,
            contentHash: fp,
            pipelineState: asJson({
              discoverySource: source,
              statusCode: statusCheck?.status ?? 200,
              fetchedAt: new Date().toISOString(),
              title: signals.title,
              description: signals.description,
              headings: signals.headings,
              language: signals.language,
              jsonLd: signals.jsonLd,
              // Captured here because the DOM is the only place these signals
              // exist — see `readPageSignals`. The extract stage applies the
              // page-type gate; the DOM-level filtering already happened.
              serviceCandidates: signals.serviceCandidates,
              valuePropCandidates: signals.valuePropCandidates,
            }),
          },
        });
        ctx.budget.spendPages(1);
        return res.html;
      } catch (err) {
        // Transient — no row, so a resumed run retries this URL rather than
        // treating a network blip as a permanent verdict about the page.
        this.logger.warn('Discovery fetch failed ' + url + ' (source: ' + source + '): ' + (err as Error).message);
        return null;
      }
    };

    let homeHtml: string | null = null;
    if (!seen.has(urlKey(origin + '/'))) {
      homeHtml = await visit(origin + '/', 'homepage');
      if (!homeHtml) {
        await ctx.note(`Homepage fetch failed for ${origin}/ — nav-link discovery and homepage content are unavailable this run.`);
      }
    }
    // On a resumed run the homepage is already a row and its HTML is gone (not
    // stored), so link discovery falls through to the guessed paths below.
    // Acceptable: that path is only reached when the site publishes no usable
    // sitemap, which is the case the guessed list exists for.

    // §1 — sitemap + robots.txt is the source of truth for real URLs on the site.
    let fromSitemap: string[] = [];
    if (ctx.budget.budgetLeft()) {
      fromSitemap = await this.sitemapCandidates(ctx, origin);
      for (const url of fromSitemap) {
        if (!ctx.budget.budgetLeft()) break;
        await visit(url, 'sitemap');
      }
    }

    // §2 — only when the site has no usable sitemap do we fall back to whatever
    // links the homepage itself points at (nav/header first, then anywhere on
    // the page). A fixed guessed-path list is the last resort of all, and only
    // fires when even the homepage gave us nothing to follow.
    if (ctx.budget.budgetLeft() && fromSitemap.length === 0) {
      const navLinks = homeHtml ? internalNavLinks(homeHtml, origin) : [];
      const bodyLinks = homeHtml ? allInternalLinks(homeHtml, origin) : [];
      const homeLinks = navLinks.length > 0 ? navLinks : bodyLinks;
      const fallback = homeLinks.length > 0 ? homeLinks : HIGH_SIGNAL_PATHS.map((p) => origin + p);
      const source = homeLinks.length > 0 ? 'homepage-links' : 'guess';
      for (const url of fallback) {
        if (!ctx.budget.budgetLeft()) break;
        await visit(url, source);
      }
    }

    await ctx.checkpoint();

    const total = await this.prisma.discoveredPage.count({
      where: { discoveryRunId: ctx.runId, fetchStatus: { in: ['FETCHED', 'EXCLUDED'] } },
    });
    const failed = await this.prisma.discoveredPage.count({
      where: { discoveryRunId: ctx.runId, fetchStatus: 'FAILED' },
    });
    const { maxPages, maxRequests } = ctx.budget.limits;

    if (total === 0) {
      await ctx.note(`Discovery found no reachable pages on ${ctx.project.domain} — context will be metadata-only.`);
    } else if (total < maxPages && ctx.budget.snapshot().requestsSpent >= maxRequests) {
      await ctx.note(
        `Discovery stopped at the request budget (${maxRequests}) with only ${total} of up to ${maxPages} pages fetched — discovery is incomplete.`,
      );
    }
    if (failed > 0) {
      await ctx.note(
        `${failed} candidate URL(s) were reached but unusable (dead link, soft-404 or empty render) and were recorded as FAILED rather than counted as pages.`,
      );
    }
  }

  /**
   * Pull URLs out of the sitemap (§3: robots.txt `Sitemap:` directives first,
   * then common fallback paths). Index-aware to a bounded depth — a sitemap
   * index can point at many child sitemaps, and a child can itself be another
   * index, so the whole tree is walked (capped at MAX_SITEMAP_FILES /
   * MAX_SITEMAP_DEPTH) rather than just the first few files — counting every
   * read against the shared request budget.
   */
  private async sitemapCandidates(ctx: DiscoveryRunContext, origin: string): Promise<string[]> {
    const urls: string[] = [];

    const readRaw = async (url: string): Promise<string | null> => {
      if (ctx.budget.requestsLeft() <= 0) return null;
      ctx.budget.spendRequests(1);
      try {
        const res = await this.fetcher.fetch({ url, timeout: 20000 }, 'discovery', ctx.runId);
        return res.status === 200 && res.body ? res.body : null;
      } catch {
        return null;
      }
    };
    const readSitemap = async (url: string): Promise<string[]> => {
      const body = await readRaw(url);
      return body ? parseSitemapLocs(body) : [];
    };

    // §3.1 — robots.txt Sitemap: directives take priority over guessed paths.
    const robotsBody = await readRaw(origin + '/robots.txt');
    const fromRobots = robotsBody ? parseRobotsSitemaps(robotsBody) : [];

    // §3.2 — common fallback paths, tried only when robots.txt named nothing.
    const sitemapEntryPoints = fromRobots.length > 0 ? fromRobots : SITEMAP_ENTRY_POINTS.map((p) => origin + p);

    const top: string[] = [];
    for (const entry of sitemapEntryPoints) {
      if (ctx.budget.requestsLeft() <= 0) break;
      top.push(...(await readSitemap(entry)));
      if (top.length > 0) break; // first entry point that yields anything wins — avoid re-reading every fallback path
    }

    // A sitemap index can point at any number of child sitemaps (large sites
    // often split by type: pages, products, blog, ...), and a child can itself
    // be another index. Walk the whole tree within the request budget instead
    // of only reading the first few — otherwise most of the site's real URLs
    // never even get considered.
    const flat: string[] = top.filter((u) => !isSitemapFile(u));
    let frontier = top.filter((u) => isSitemapFile(u));
    let filesRead = 0;
    for (let depth = 0; depth < MAX_SITEMAP_DEPTH && frontier.length > 0 && filesRead < MAX_SITEMAP_FILES; depth++) {
      const nextFrontier: string[] = [];
      for (const child of frontier) {
        if (ctx.budget.requestsLeft() <= 0 || filesRead >= MAX_SITEMAP_FILES) break;
        filesRead++;
        const entries = await readSitemap(child);
        flat.push(...entries.filter((u) => !isSitemapFile(u)));
        nextFrontier.push(...entries.filter((u) => isSitemapFile(u)));
      }
      frontier = nextFrontier;
    }

    const sameOrigin = flat.filter((u) => u.startsWith(origin)); // own host only

    // A real sitemap can be almost entirely one repeating pattern (a product
    // catalog, a blog archive) — keeping every URL would crowd the page budget
    // with near-duplicates and starve everything else. Group by path template
    // (parent path, so /brand/<slug> and /brand/<slug2> collapse to the same
    // group) and keep only a few samples per group.
    const byTemplate = new Map<string, string[]>();
    for (const u of sameOrigin) {
      const path = u.slice(origin.length).split(/[?#]/)[0]!;
      const segments = path.split('/').filter(Boolean);
      const template = segments.length >= 2 ? segments.slice(0, -1).join('/') : path;
      const group = byTemplate.get(template) ?? [];
      if (group.length < SAMPLES_PER_TEMPLATE) group.push(u);
      byTemplate.set(template, group);
    }
    for (const group of byTemplate.values()) urls.push(...group);

    // High-signal keyword matches (about, pricing, faq, ...) lead; everything
    // else — the site's real structure, whatever shape that takes — fills the
    // rest of the budget rather than being discarded outright.
    urls.sort((a, b) => {
      const aSignal = HIGH_SIGNAL_PATTERNS.test(a) ? 0 : 1;
      const bSignal = HIGH_SIGNAL_PATTERNS.test(b) ? 0 : 1;
      if (aSignal !== bSignal) return aSignal - bSignal;
      return a.split('/').length - b.split('/').length || a.length - b.length;
    });
    return urls.slice(0, DISCOVERY_URL_CAP);
  }
}
