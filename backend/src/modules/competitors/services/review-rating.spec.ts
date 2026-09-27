import { describe, expect, it } from 'vitest';
import { extractAggregateRating } from './review-rating.js';

function jsonLd(obj: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
}

describe('extractAggregateRating', () => {
  it('parses a top-level AggregateRating block', () => {
    const html = jsonLd({ '@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 120 });
    expect(extractAggregateRating(html, 'g2')).toEqual({ source: 'g2', rating: 4.5, count: 120 });
  });

  it('parses an AggregateRating nested under a parent entity', () => {
    const html = jsonLd({ '@type': 'Product', name: 'Widget', aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.8', ratingCount: '30' } });
    expect(extractAggregateRating(html, 'trustpilot')).toEqual({ source: 'trustpilot', rating: 4.8, count: 30 });
  });

  it('returns null when no AggregateRating exists anywhere', () => {
    const html = jsonLd({ '@type': 'Organization', name: 'Acme' });
    expect(extractAggregateRating(html, 'g2')).toBeNull();
  });

  it('returns null on malformed JSON-LD rather than throwing', () => {
    const html = '<script type="application/ld+json">{not valid json</script>';
    expect(extractAggregateRating(html, 'g2')).toBeNull();
  });

  it('returns null when ratingValue is missing or non-numeric', () => {
    const html = jsonLd({ '@type': 'AggregateRating', ratingValue: 'not-a-number' });
    expect(extractAggregateRating(html, 'g2')).toBeNull();
  });
});
