/**
 * Pure helpers shared by the discovery pipeline's stages.
 *
 * Every function here is ported from the old repo's `aeo-context.service.ts`
 * (private methods of the same names) with its behaviour unchanged — these are
 * the load-bearing details of the crawl (URL dedup keys, soft-404 detection,
 * the JSON-LD walk, the heading-candidate filter), not incidental utilities.
 * Keeping them in one place means a stage never has to re-derive one slightly
 * differently from its neighbour.
 *
 * No DI, no I/O — these are testable in isolation.
 */

import * as cheerio from 'cheerio';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  ABOUT_PATTERN,
  BLOG_PATTERN,
  CAREERS_PATTERN,
  CART_PATTERN,
  CASE_STUDY_PATTERN,
  HOMEPAGE_ALL_LINK_CAP,
  HOMEPAGE_NAV_LINK_CAP,
  INDUSTRIES_PATTERN,
  JSON_LD_FIELDS,
  LEADERSHIP_PATTERN,
  LOCATION_PATTERN,
  LOGIN_PATTERN,
  MAX_JSON_LD_ENTITIES_PER_PAGE,
  MAX_JSON_LD_RAW,
  MERCHANDISING_NOISE,
  NAV_NOISE,
  PARTNER_PATTERN,
  POLICY_PATTERN,
  PRESS_PATTERN,
  PRICING_PATTERN,
  RELEVANT_JSON_LD_TYPES,
  SECURITY_PATTERN,
  SERVICE_PATTERN,
  TIER_AND_STEP_WORDS,
} from '../discovery.constants.js';
import type { JsonLdEntity, PageType } from '../discovery.types.js';

/**
 * Dedup key for a URL: trailing slash and case are the two differences that
 * never mean a different page. Deliberately *not* a full normalizer — query
 * strings and paths are left alone, because on a real site those do distinguish
 * pages, and over-normalizing here would collapse two services into one.
 */
export function urlKey(url: string): string {
  return url.replace(/\/$/, '').toLowerCase();
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/** Same normalization the Projects module applies — kept in step with it deliberately. */
export function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .trim();
}

/**
 * Cheap content fingerprint used to spot a catch-all route serving the same
 * document under many paths: a DJB2-style hash of the first 4000 characters of
 * whitespace-normalized content, plus the length of that slice.
 *
 * The cutoff is deliberate and has a known consequence: two genuinely different
 * pages that share their first 4000 characters — realistically only if they
 * share a very long block of boilerplate — fingerprint identically, and the
 * second is dropped as a duplicate. That is the old code's behaviour and its
 * trade-off still holds, because the alternative (hashing the whole page) makes
 * the check meaningless on any page with a dynamic element.
 */
export function fingerprint(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim().slice(0, 4000);
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = (Math.imul(hash, 33) ^ normalized.charCodeAt(i)) >>> 0;
  }
  return String(hash) + ':' + normalized.length;
}

/**
 * Cheap heuristic for a soft-404 (HTTP 200 with an error-page body) or a
 * rendered error page. The short-body rule exists because a real page's text is
 * never under 120 characters — without it, every footer containing "not found"
 * would be discarded.
 */
export function looksLike404(title: string | null | undefined, text: string | null | undefined): boolean {
  const t = (title || '').trim();
  if (/^\s*404\b/i.test(t) || /\bnot found\b/i.test(t)) return true;
  const body = (text || '').trim();
  return body.length > 0 && body.length < 120 && /\bnot found\b/i.test(body);
}

// ─── Link discovery ─────────────────────────────────────────────────────────

/** Same-origin nav/header links from the homepage, deduped. */
export function internalNavLinks(html: string, origin: string): string[] {
  return internalLinksFrom(html, origin, 'nav a[href], header a[href]', HOMEPAGE_NAV_LINK_CAP);
}

/** Every same-origin link anywhere on the homepage — last-resort fallback when there's no sitemap. */
export function allInternalLinks(html: string, origin: string): string[] {
  return internalLinksFrom(html, origin, 'a[href]', HOMEPAGE_ALL_LINK_CAP);
}

export function internalLinksFrom(html: string, origin: string, selector: string, limit: number): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  const seen = new Set<string>();
  $(selector).each((_, el) => {
    const href = $(el).attr('href') || '';
    let abs: string;
    try {
      abs = new URL(href, origin).toString();
    } catch {
      return;
    }
    if (!abs.startsWith(origin) || seen.has(abs)) return;
    seen.add(abs);
    out.push(abs);
  });
  return out.slice(0, limit);
}

/**
 * Extract `<loc>` entries from a sitemap or sitemap-index body. Returns
 * everything found — the caller decides which entries are child sitemaps to
 * walk (by extension) and which are real pages.
 */
export function parseSitemapLocs(body: string): string[] {
  return [...body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]!);
}

/** Sitemap URLs named by `robots.txt` `Sitemap:` directives, in order. */
export function parseRobotsSitemaps(robotsBody: string): string[] {
  return [...robotsBody.matchAll(/^\s*Sitemap:\s*(\S+)/gim)].map((m) => m[1]!.trim());
}

/** A sitemap tree node that is itself a sitemap file (possibly gzipped), not a page. */
export function isSitemapFile(url: string): boolean {
  return /\.xml(\.gz)?$/i.test(url);
}

// ─── Page classification ────────────────────────────────────────────────────

/**
 * Classify a page by its URL alone — the spec doc's own rule ("deterministic
 * URL/title rules first, then a lightweight classifier when ambiguous"), and
 * exactly what the old code's `classifyPageType` did.
 *
 * Pattern order is load-bearing and ported verbatim: `about` is checked before
 * `service` because `/about/services` is an about page, and the always-excluded
 * classes (`cart`, `login`, `policy`) are checked first so a `/pricing/plans`
 * under `/login` cannot be misread as a pricing page.
 *
 * Because this needs no page content, the discover stage applies it as each URL
 * is queued — which is why the inspect stage does not classify (there is
 * nothing left for it to decide, and re-running the same regex twice would only
 * create a second place for the order to drift).
 */
export function classifyPageType(url: string, isHome: boolean): PageType {
  if (isHome) return 'homepage';
  if (CART_PATTERN.test(url)) return 'cart';
  if (LOGIN_PATTERN.test(url)) return 'login';
  if (POLICY_PATTERN.test(url)) return 'policy';
  if (PRICING_PATTERN.test(url)) return 'pricing';
  if (ABOUT_PATTERN.test(url)) return 'about';
  if (INDUSTRIES_PATTERN.test(url)) return 'industries';
  if (LOCATION_PATTERN.test(url)) return 'location';
  if (CASE_STUDY_PATTERN.test(url)) return 'case-study';
  if (SERVICE_PATTERN.test(url)) return 'service';
  if (LEADERSHIP_PATTERN.test(url)) return 'leadership';
  if (SECURITY_PATTERN.test(url)) return 'security';
  if (PRESS_PATTERN.test(url)) return 'press';
  if (CAREERS_PATTERN.test(url)) return 'careers';
  if (PARTNER_PATTERN.test(url)) return 'partner';
  if (BLOG_PATTERN.test(url)) return 'blog';
  return 'other';
}

/**
 * How much the classification is worth trusting. A named pattern on the URL is
 * strong but not certain (a `/services` path can still be a marketing landing
 * page), a homepage is certain, and `other` means no pattern matched at all —
 * which is genuinely low-confidence, not a claim that the page is unclassified.
 */
export function classificationConfidenceFor(type: PageType): number {
  if (type === 'homepage') return 1;
  if (type === 'other') return 0.3;
  return 0.9;
}

/** Whether a page's URL is the site's own root. */
export function isHomepageUrl(url: string, origin: string): boolean {
  return urlKey(url) === urlKey(origin + '/');
}

// ─── JSON-LD ────────────────────────────────────────────────────────────────

/**
 * Parse every `application/ld+json` block on a page (§9): expand `@graph`
 * arrays, keep only schema.org types worth extracting from, and retain only the
 * fields listed in `JSON_LD_FIELDS`. Malformed blocks are skipped, never
 * thrown — one bad script tag on a page must not fail the whole run.
 */
export function extractJsonLd($: cheerio.CheerioAPI): JsonLdEntity[] {
  const out: JsonLdEntity[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw || raw.trim().length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // malformed JSON-LD — evidence, not a page failure
    }
    const graph = parsed && typeof parsed === 'object' ? (parsed as { '@graph'?: unknown })['@graph'] : undefined;
    const nodes: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(graph) ? graph : [parsed];

    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const obj = node as Record<string, unknown>;
      const typeRaw = obj['@type'];
      const types = Array.isArray(typeRaw) ? typeRaw : typeRaw ? [typeRaw] : [];
      const type = types.find((t): t is string => typeof t === 'string' && RELEVANT_JSON_LD_TYPES.has(t));
      if (!type) continue;
      const fields: JsonLdEntity['fields'] = {};
      for (const key of JSON_LD_FIELDS) {
        if (obj[key] !== undefined) fields[key] = obj[key];
      }
      if (Object.keys(fields).length > 0) out.push({ type, fields });
    }
  });
  return out.slice(0, MAX_JSON_LD_ENTITIES_PER_PAGE);
}

/**
 * The raw JSON-LD script text of a page, capped — persisted separately from the
 * cleaned visible text so the validate stage can check an excerpt that came from
 * structured data (which visible-text extraction strips out) and so a later
 * re-parse doesn't need the whole page source. See docs/analysis/discovery.md
 * "What we persist per page".
 */
export function rawJsonLd($: cheerio.CheerioAPI): string | null {
  const blocks: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (raw && raw.trim().length > 0) blocks.push(raw);
  });
  if (blocks.length === 0) return null;
  return truncate(blocks.join('\n'), MAX_JSON_LD_RAW);
}

// ─── Heading / hero-text candidates ─────────────────────────────────────────

/**
 * Whether a heading or hero line is plausibly a service name or value
 * proposition rather than nav chrome, a tier label, a step name or a sentence.
 *
 * Ported exactly: the word-count window, the verb and filler-word rejections
 * and the trailing-punctuation rule are what stand between "Fractional CMO
 * Services" (kept) and "Book a demo" / "Starter" / "We help teams grow" /
 * "Trusted by 400+ teams." (all dropped). Loosening any one of them lets noise
 * into the offerings list, which is the field later modules lean on hardest.
 */
export function isCandidatePhrase(text: string): boolean {
  if (text.length < 3 || text.length > 70) return false;
  if (NAV_NOISE.test(text)) return false;
  if (MERCHANDISING_NOISE.test(text)) return false;
  if (/^\d+[%+]?$/.test(text)) return false;
  if (/[?!]$/.test(text)) return false;
  if (/[.]$/.test(text)) return false;
  if (!/[a-z]/i.test(text)) return false;

  const words = text.split(/\s+/);
  if (words.length > 6) return false;
  if (words.length < 2) return false;
  if (words.every((w) => TIER_AND_STEP_WORDS.test(w))) return false;
  if (/^(and|but|or|so|because|if|when|we|they|you|it|our|your|their|this|that|these|those|every|a|an|the)\b/i.test(text)) return false;
  if (/\b(is|are|was|were|has|have|had|does|do|did|can|will|would|should|could|make|makes|owns?|started|created|solved?)\b/i.test(text)) return false;
  return true;
}

/** Collapse a heading's whitespace — pages use runs of spaces/newlines as layout. */
export function normalizeHeading(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * Blocks whose text is about *people*, not offerings. The old code's own note:
 * without this, a team grid or a testimonial rendered with headings has its
 * members' names read as services ("Jordan Blake" is not a product). Ported
 * verbatim, `footer`/`nav` included — nav chrome is the other big source of
 * false services.
 */
const PERSON_BLOCK_SELECTOR =
  '[class*="team"],[class*="person"],[class*="people"],[class*="author"],[class*="bio"],' +
  '[class*="staff"],[class*="member"],[class*="founder"],[class*="testimonial"],[class*="quote"],' +
  '[class*="logo"],footer,nav';

/**
 * `node` is typed `unknown` because cheerio's element type (`domhandler`'s
 * `AnyNode`) is not re-exported from its public entry point — rather than take a
 * dependency on a transitive package just to name it, the cast happens here,
 * at the one place that needs it.
 */
function inPersonBlock($: cheerio.CheerioAPI, node: unknown): boolean {
  return $(node as never).closest(PERSON_BLOCK_SELECTOR).length > 0;
}

/**
 * Candidate service names on one page, read straight off the DOM.
 *
 * **This has to run while the DOM is still in hand.** The deterministic
 * extraction pass needs heading levels and card/tile structure that the cleaned
 * visible text no longer distinguishes — and this module deliberately stores no
 * raw HTML — so the inspect stage captures the candidates at fetch time and the
 * extract stage only applies the page-type gate. See docs/analysis/discovery.md
 * "As built".
 *
 * The per-list cap is 40; the extract stage separately caps a page's total
 * deterministic facts at 40, which is where the old code applied its cap.
 */
export function extractServiceCandidates($: cheerio.CheerioAPI): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const collect = (selector: string): void => {
    $(selector).each((_, el) => {
      const text = normalizeHeading($(el).text());
      if (!text || seen.has(text.toLowerCase()) || out.length >= 40) return;
      if (!isCandidatePhrase(text) || inPersonBlock($, el)) return;
      seen.add(text.toLowerCase());
      out.push(text);
    });
  };
  collect('h2, h3');
  collect('[class*="card"] h4, [class*="service"] h4, [class*="tile"] h4, li > strong');
  return out;
}

/**
 * Candidate value propositions: the H1 and any hero paragraph, in the old
 * length window. Deliberately **not** run through `isCandidatePhrase` — a
 * tagline is a sentence, which that filter exists to reject.
 */
export function extractValuePropCandidates($: cheerio.CheerioAPI): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  $('h1, [class*="hero"] p').each((_, el) => {
    const text = normalizeHeading($(el).text());
    if (!(text.length > 15 && text.length < 160) || seen.has(text.toLowerCase())) return;
    seen.add(text.toLowerCase());
    out.push(text);
  });
  return out;
}

/**
 * Whitespace-normalize text for the validate stage's verbatim substring check:
 * collapse whitespace, trim, lowercase. Nothing else — no punctuation stripping,
 * no stemming — because the check's whole value is that it is exact.
 */
export function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Case-insensitive, whitespace-insensitive "does this excerpt appear in this page" check. */
export function containsVerbatim(haystack: string, needle: string): boolean {
  const n = normalizeForMatch(needle);
  if (n.length === 0) return false;
  return normalizeForMatch(haystack).includes(n);
}

/**
 * Prisma's `InputJsonValue` rejects our working-state interfaces because their
 * optional keys widen to `| undefined`, which JSON cannot carry. Every value
 * passed through here is plain JSON by construction, so this cast only tells
 * the compiler what is already true. One definition, so the pipeline's stages
 * and the orchestrator cannot drift on how they write JSON columns.
 */
export function asJson(value: unknown): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

/** Dedup rows by a derived key, keeping the first occurrence. */
export function dedupeBy<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const k = key(row);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}

/** Trim, drop empties, dedupe case-insensitively — the shape every value list wants. */
export function cleanValueList(values: string[]): string[] {
  return dedupeBy(
    values.map((v) => v.trim()).filter((v) => v.length > 0),
    (v) => v.toLowerCase(),
  );
}

/** Absolute URL of a possibly-relative href, or null when it cannot be resolved. */
export function absoluteUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** The origin (`https://host`) of a normalized domain string. */
export function originOf(domain: string): string {
  return 'https://' + normalizeDomain(domain);
}

/** Hostname of a URL, lowercased and `www.`-stripped, or null when unparseable. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}
