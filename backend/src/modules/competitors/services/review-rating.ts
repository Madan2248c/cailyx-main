/**
 * `AggregateRating` JSON-LD parser — pure, no I/O. Schema markup only, no
 * scraping, no ToS-risk crawl. Reusable against any fetched HTML: today
 * it's run against the homepage fetch itself (some sites embed a rating
 * directly, e.g. via `LocalBusiness`/`Product`); a future pass that knows
 * a specific review-site URL (G2/Trustpilot/Capterra) for a competitor
 * would call this against that fetch too — no review-site URL is
 * auto-discovered in v1, see the module README's documented gap.
 *
 * @module competitors/services/review-rating
 */

import * as cheerio from 'cheerio';
import type { ReviewRating } from '../competitors.types.js';

const MAX_WALK_DEPTH = 6;

export function extractAggregateRating(html: string, source: string): ReviewRating | null {
  const $ = cheerio.load(html);
  let found: ReviewRating | null = null;

  $('script[type="application/ld+json"]').each((_, el) => {
    if (found) return;
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      found = walk(parsed, source, 0);
    } catch {
      // malformed JSON-LD — skip this block, keep looking in the others
    }
  });

  return found;
}

function walk(node: unknown, source: string, depth: number): ReviewRating | null {
  if (depth > MAX_WALK_DEPTH || node === null || typeof node !== 'object') return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const r = walk(item, source, depth + 1);
      if (r) return r;
    }
    return null;
  }

  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  const isAggregateRating = type === 'AggregateRating' || (Array.isArray(type) && type.includes('AggregateRating'));
  if (isAggregateRating) {
    const rating = toNumber(obj.ratingValue);
    if (rating != null) {
      return { source, rating, count: toNumber(obj.reviewCount ?? obj.ratingCount) };
    }
  }

  // AggregateRating is commonly nested under a parent entity's own `aggregateRating` field.
  if (obj.aggregateRating && typeof obj.aggregateRating === 'object') {
    const r = walk(obj.aggregateRating, source, depth + 1);
    if (r) return r;
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      const r = walk(value, source, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}
