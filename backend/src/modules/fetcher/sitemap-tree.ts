/**
 * Sitemap discovery — the crawl-infrastructure piece shared by the Discovery
 * and Technical Audit modules.
 *
 * Both modules need the same underlying work: read `robots.txt`'s declared
 * `Sitemap:` directives (falling back to conventional paths only when
 * robots.txt names none), fetch each entry point, walk sitemap-index nesting
 * to a bounded depth, and return the flat set of URLs found. Lives here
 * rather than inside either module because it is crawl infrastructure, not a
 * Discovery- or Technical-Audit-specific concern — see
 * docs/analysis/technical-audit.md "Sitemap check" for the extraction
 * rationale.
 *
 * **Fixes a real gap in what Discovery already shipped**: the code this was
 * extracted from stopped reading robots.txt's declared sitemaps at the first
 * entry point that yielded anything. Fine for Discovery (which only needs a
 * representative page sample and narrows further downstream), wrong for a
 * caller that needs full coverage — a site can legitimately declare
 * `Sitemap: /sitemap-pages.xml` AND `Sitemap: /sitemap-blog.xml` as two
 * separate lines, and the old logic would silently never read the second
 * one. This version reads from **every** declared entry point, still bounded
 * by the caller's request budget.
 *
 * @module fetcher/sitemap-tree
 */

import type { FetcherService } from './fetcher.service.js';

/** One URL found in a sitemap, with its declared `<lastmod>` if any. */
export interface SitemapTreeEntry {
  url: string;
  lastmod: string | null;
}

/** One entry point that was tried — a robots-declared sitemap, or a guessed conventional path. */
export interface SitemapEntryPointResult {
  url: string;
  /** True when the fetch returned a real `<urlset>` or `<sitemapindex>` document. */
  resolved: boolean;
  /** Only meaningful when `resolved` is true. */
  isIndex: boolean;
  /** Null when the fetch itself failed (network error, timeout) rather than returning a bad status. */
  statusCode: number | null;
}

export interface SitemapTreeResult {
  /** Every entry point tried, in the order tried — robots-declared first if any existed, else the fallback paths. */
  entryPoints: SitemapEntryPointResult[];
  /** True when robots.txt named at least one `Sitemap:` directive, whether or not it resolved. */
  declaredInRobots: boolean;
  /**
   * Every URL found across every entry point that resolved, index nesting
   * walked and flattened, deduped by URL. When the same URL appears under
   * more than one entry point (or more than one index branch) with
   * different `<lastmod>` values, the first non-null one wins.
   */
  entries: SitemapTreeEntry[];
}

/** The minimum a caller's request budget must support — duck-typed so this module never imports either caller's budget class. */
export interface SitemapCrawlBudget {
  requestsLeft(): number;
  spendRequests(n?: number): void;
}

export interface SitemapTreeOptions {
  /** How many sitemap-index levels to walk (an index pointing at indexes pointing at indexes...). */
  maxDepth: number;
  /** Hard cap on child-sitemap files read across the whole tree, all entry points combined. */
  maxFiles: number;
  /** Conventional paths tried when robots.txt names no `Sitemap:` directive, e.g. `/sitemap.xml`. */
  fallbackPaths: readonly string[];
  /** Attributed to the fetcher's cost/log tracking. */
  calledBy: string;
}

/** Extract `<loc>` entries from a sitemap or sitemap-index body. */
export function parseSitemapLocs(body: string): string[] {
  return [...body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]!);
}

/** Sitemap URLs named by `robots.txt` `Sitemap:` directives, in order. */
export function parseRobotsSitemaps(robotsBody: string): string[] {
  return [...robotsBody.matchAll(/^\s*Sitemap:\s*(\S+)/gim)].map((m) => m[1]!.trim());
}

/** A sitemap-tree node that is itself a sitemap file (possibly gzipped), not a page. */
export function isSitemapFile(url: string): boolean {
  return /\.xml(\.gz)?$/i.test(url);
}

/**
 * `<url>` blocks paired with their own `<lastmod>` — matching per-block
 * rather than harvesting `<loc>`/`<lastmod>` globally matters, since
 * sitemaps routinely omit `<lastmod>` on some entries and two independent
 * global matches would silently shift every date by one.
 */
export function parseUrlset(body: string): SitemapTreeEntry[] {
  const out: SitemapTreeEntry[] = [];
  for (const block of body.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)) {
    const inner = block[1]!;
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/i.exec(inner);
    if (!loc) continue;
    const lastmodMatch = /<lastmod>\s*([^<]+?)\s*<\/lastmod>/i.exec(inner);
    out.push({ url: decodeXmlEntities(loc[1]!), lastmod: lastmodMatch ? normaliseLastmod(lastmodMatch[1]!) : null });
  }
  return out;
}

/** Sitemaps are XML, so `&amp;` in a URL is routine. */
function decodeXmlEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** W3C datetime → ISO. Null on anything unparseable. */
function normaliseLastmod(raw: string): string | null {
  const d = new Date(raw.trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Discover and flatten a site's sitemap tree.
 *
 * Never throws — an unreachable or malformed sitemap is a caller's finding
 * to report, not this function's error to propagate. Every fetch (robots.txt
 * and every candidate/child sitemap) is checked against `budget.requestsLeft()`
 * before it happens and counted via `budget.spendRequests()` after, so a
 * caller with a tight budget gets a partial-but-honest tree rather than this
 * function ignoring the budget it was handed.
 */
export async function discoverSitemapTree(
  fetcher: FetcherService,
  origin: string,
  budget: SitemapCrawlBudget,
  runId: string,
  opts: SitemapTreeOptions,
): Promise<SitemapTreeResult> {
  const readRaw = async (url: string): Promise<string | null> => {
    if (budget.requestsLeft() <= 0) return null;
    budget.spendRequests(1);
    try {
      const res = await fetcher.fetch({ url, timeout: 20000 }, opts.calledBy, runId);
      return res.status === 200 && res.body ? res.body : null;
    } catch {
      return null;
    }
  };

  const robotsBody = await readRaw(origin + '/robots.txt');
  const declared = robotsBody ? parseRobotsSitemaps(robotsBody) : [];
  const entryPointUrls = declared.length > 0 ? declared : opts.fallbackPaths.map((p) => origin + p);

  const entryPoints: SitemapEntryPointResult[] = [];
  const entries = new Map<string, SitemapTreeEntry>();
  const addEntries = (found: SitemapTreeEntry[]): void => {
    for (const entry of found) {
      const existing = entries.get(entry.url);
      if (!existing) {
        entries.set(entry.url, entry);
      } else if (!existing.lastmod && entry.lastmod) {
        entries.set(entry.url, entry);
      }
    }
  };

  // Read from EVERY declared entry point — the fix this module exists for.
  // The old behaviour ("first entry point that yields anything wins") is
  // gone; each one is tried, and the overall request budget (not a
  // first-success shortcut) is what bounds the work.
  let filesRead = 0;
  for (const entryUrl of entryPointUrls) {
    if (budget.requestsLeft() <= 0) {
      entryPoints.push({ url: entryUrl, resolved: false, isIndex: false, statusCode: null });
      continue;
    }
    let status: number | null = null;
    let body: string | null = null;
    try {
      const res = await fetcher.fetch({ url: entryUrl, timeout: 20000 }, opts.calledBy, runId);
      budget.spendRequests(1);
      status = res.status;
      body = res.status === 200 && res.body ? res.body : null;
    } catch {
      budget.spendRequests(1);
    }

    if (!body) {
      entryPoints.push({ url: entryUrl, resolved: false, isIndex: false, statusCode: status });
      continue;
    }

    const isIndex = /<sitemapindex[\s>]/i.test(body);
    entryPoints.push({ url: entryUrl, resolved: true, isIndex, statusCode: status });

    // Every `<loc>` in the body, bucketed by file extension — not by whether
    // the document declared itself a `<sitemapindex>`. This is what the code
    // being extracted here did, and it's the more robust rule: a urlset's
    // `<loc>`s are page URLs (never end in .xml), an index's `<loc>`s are
    // child sitemap URLs (always end in .xml, by convention every real
    // sitemap host follows) — the split falls out of the URLs themselves,
    // with no dependency on the document actually declaring the right root
    // tag. `parseUrlset` separately captures each page `<loc>`'s own
    // `<lastmod>` (absent from a pure index's `<sitemap>` blocks, so it
    // contributes no page entries there — exactly right).
    addEntries(parseUrlset(body));
    let frontier = parseSitemapLocs(body).filter(isSitemapFile);

    // Sitemap-index walk, bounded globally across every entry point — a
    // large site's several declared sitemaps can each themselves be an
    // index, and the file/depth caps apply to the whole tree, not per entry
    // point, so the total work stays predictable regardless of how many
    // top-level sitemaps a site declares.
    for (let depth = 0; depth < opts.maxDepth && frontier.length > 0 && filesRead < opts.maxFiles; depth++) {
      const nextFrontier: string[] = [];
      for (const child of frontier) {
        if (budget.requestsLeft() <= 0 || filesRead >= opts.maxFiles) break;
        filesRead++;
        const childBody = await readRaw(child);
        if (!childBody) continue;
        addEntries(parseUrlset(childBody));
        nextFrontier.push(...parseSitemapLocs(childBody).filter(isSitemapFile));
      }
      frontier = nextFrontier;
    }
  }

  return {
    entryPoints,
    declaredInRobots: declared.length > 0,
    entries: [...entries.values()],
  };
}
