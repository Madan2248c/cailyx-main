/**
 * Per-page signal extraction — cheerio-based, no scoring logic (that's
 * `seo-rubric.ts`).
 *
 * Ported verbatim from the old repo's `checks/page-signals.ts`. Heading
 * *level* extraction lives here; heading-level-*skip detection* lives in the
 * rubric — this module only reports the raw sequence.
 *
 * @module technical-audit/services/checks/page-signals
 */

import * as cheerio from 'cheerio';
import { fingerprint } from '../../../fetcher/content-fingerprint.js';
import type { PageSignals } from './seo-rubric.js';

export interface ExtractedPageSignals extends PageSignals {
  jsonLdTypes: string[];
}

const RELEVANT_JSON_LD_KEYS = ['@graph', 'mainEntity', 'itemListElement', 'hasPart'] as const;
const MAX_JSON_LD_WALK_DEPTH = 6;

/**
 * Read every signal the rubric needs off one page's HTML.
 *
 * `status`/`url`/`siteHost` come from the caller (the fetch already
 * happened); this function only reads the HTML it's handed.
 */
export function extractPageSignals(html: string, status: number, url: string, siteHost: string): ExtractedPageSignals {
  const $ = cheerio.load(html);

  const title = ($('head title').first().text() || $('title').first().text() || '').trim() || null;
  const metaDescription =
    ($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '').trim() || null;
  const canonical = $('link[rel="canonical"]').attr('href')?.trim() || null;
  const noindex = ($('meta[name="robots"]').attr('content') || '').toLowerCase().includes('noindex');

  const headingLevels: number[] = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const level = Number(el.tagName.slice(1));
    if (Number.isFinite(level)) headingLevels.push(level);
  });
  const h1Count = $('h1').length;

  // Word count: strip elements that are never visible reading content, clone
  // first so this never mutates the loaded document for anything reading it
  // afterward.
  const body = $('body').clone();
  body.find('script, style, noscript, template, svg').remove();
  const words = body
    .text()
    .replace(/\s+/g, ' ')
    .trim();
  const wordCount = words.length > 0 ? words.split(' ').length : 0;
  const contentHash = fingerprint(words);

  // Images: a "decorative" image is excluded from counts entirely —
  // `alt=""`, `aria-hidden="true"`, `role="presentation"`, or a 1×1 tracking
  // pixel. `alt` wholly *absent* (not `alt=""`) counts as missing.
  let imageCount = 0;
  let imagesMissingAlt = 0;
  $('img').each((_, el) => {
    const $img = $(el);
    const alt = $img.attr('alt');
    const decorative =
      alt === '' ||
      $img.attr('aria-hidden') === 'true' ||
      $img.attr('role') === 'presentation' ||
      ($img.attr('width') === '1' && $img.attr('height') === '1');
    if (decorative) return;
    imageCount++;
    if (alt === undefined) imagesMissingAlt++;
  });

  const { count: jsonLdCount, valid: jsonLdValid, types: jsonLdTypes } = extractJsonLd($);

  return {
    status,
    title,
    metaDescription,
    canonical,
    noindex,
    headingLevels,
    h1Count,
    wordCount,
    imageCount,
    imagesMissingAlt,
    jsonLdCount,
    jsonLdValid,
    jsonLdTypes,
    contentHash,
  };
}

function extractJsonLd($: cheerio.CheerioAPI): { count: number; valid: boolean; types: string[] } {
  let count = 0;
  let anyInvalid = false;
  const types = new Set<string>();

  $('script[type="application/ld+json"]').each((_, el) => {
    count++;
    const raw = $(el).contents().text().trim();
    if (!raw) {
      anyInvalid = true;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      anyInvalid = true;
      return;
    }
    collectJsonLdTypes(parsed, types, 0);
  });

  return { count, valid: count > 0 && !anyInvalid, types: [...types] };
}

/**
 * Recursively walk a parsed JSON-LD document for every `@type`, following
 * `@graph`/`mainEntity`/`itemListElement`/`hasPart` nesting — depth-capped to
 * guard against a malformed or circular document.
 */
function collectJsonLdTypes(node: unknown, out: Set<string>, depth: number): void {
  if (depth > MAX_JSON_LD_WALK_DEPTH || node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) collectJsonLdTypes(item, out, depth + 1);
    return;
  }

  const obj = node as Record<string, unknown>;
  const typeRaw = obj['@type'];
  if (typeof typeRaw === 'string') out.add(typeRaw);
  else if (Array.isArray(typeRaw)) for (const t of typeRaw) if (typeof t === 'string') out.add(t);

  for (const key of RELEVANT_JSON_LD_KEYS) {
    if (key in obj) collectJsonLdTypes(obj[key], out, depth + 1);
  }
}
