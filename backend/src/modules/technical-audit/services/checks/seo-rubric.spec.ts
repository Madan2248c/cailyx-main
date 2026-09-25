import { describe, expect, it } from 'vitest';
import { findDuplicateContent, findPageIssues, scorePage, summarisePages, type PageSignals } from './seo-rubric.js';
import type { AuditPageResult } from '../../technical-audit.types.js';

const SITE_HOST = 'acme.com';
const PAGE_URL = 'https://acme.com/pricing';

function signals(overrides: Partial<PageSignals> = {}): PageSignals {
  return {
    status: 200,
    title: 'Pricing plans for Acme — simple, transparent pricing',
    metaDescription: 'A'.repeat(100),
    canonical: PAGE_URL,
    noindex: false,
    headingLevels: [1, 2, 2, 3],
    h1Count: 1,
    wordCount: 300,
    imageCount: 0,
    imagesMissingAlt: 0,
    jsonLdCount: 1,
    jsonLdValid: true,
    jsonLdTypes: ['Product'],
    contentHash: 'abc:300',
    ...overrides,
  };
}

describe('findPageIssues', () => {
  it('returns only page-error for a dead page, nothing else evaluated', () => {
    expect(findPageIssues(signals({ status: 500 }), PAGE_URL, SITE_HOST)).toEqual(['page-error']);
    expect(findPageIssues(signals({ status: 0 }), PAGE_URL, SITE_HOST)).toEqual(['page-error']);
  });

  it('flags a clean page with no issues', () => {
    expect(findPageIssues(signals(), PAGE_URL, SITE_HOST)).toEqual([]);
  });

  it('does not short-circuit on noindex — other checks still run', () => {
    const issues = findPageIssues(signals({ noindex: true, title: null }), PAGE_URL, SITE_HOST);
    expect(issues).toContain('noindex');
    expect(issues).toContain('title-missing');
  });

  it('title bands: missing, too short, too long, mutually exclusive', () => {
    expect(findPageIssues(signals({ title: null }), PAGE_URL, SITE_HOST)).toContain('title-missing');
    expect(findPageIssues(signals({ title: 'Short' }), PAGE_URL, SITE_HOST)).toContain('title-too-short');
    expect(findPageIssues(signals({ title: 'A'.repeat(61) }), PAGE_URL, SITE_HOST)).toContain('title-too-long');
    const clean = findPageIssues(signals({ title: 'A'.repeat(45) }), PAGE_URL, SITE_HOST);
    expect(clean.filter((i) => i.startsWith('title'))).toEqual([]);
  });

  it('meta bands: missing, too short, too long', () => {
    expect(findPageIssues(signals({ metaDescription: null }), PAGE_URL, SITE_HOST)).toContain('meta-missing');
    expect(findPageIssues(signals({ metaDescription: 'short' }), PAGE_URL, SITE_HOST)).toContain('meta-too-short');
    expect(findPageIssues(signals({ metaDescription: 'A'.repeat(161) }), PAGE_URL, SITE_HOST)).toContain('meta-too-long');
  });

  it('h1: missing vs multiple', () => {
    expect(findPageIssues(signals({ h1Count: 0 }), PAGE_URL, SITE_HOST)).toContain('h1-missing');
    expect(findPageIssues(signals({ h1Count: 2 }), PAGE_URL, SITE_HOST)).toContain('h1-multiple');
  });

  it('heading-level-skipped fires once for a skip, not once per skip', () => {
    // H1 -> H3 skips H2.
    const issues = findPageIssues(signals({ headingLevels: [1, 3, 3, 3] }), PAGE_URL, SITE_HOST);
    expect(issues.filter((i) => i === 'heading-level-skipped')).toHaveLength(1);
  });

  it('a normal progressive heading sequence is never flagged', () => {
    expect(findPageIssues(signals({ headingLevels: [1, 2, 3, 2, 3, 3] }), PAGE_URL, SITE_HOST)).not.toContain('heading-level-skipped');
  });

  it('canonical: missing, malformed, cross-domain, and same-domain-different-path is fine', () => {
    expect(findPageIssues(signals({ canonical: null }), PAGE_URL, SITE_HOST)).toContain('canonical-missing');
    // A non-http(s) scheme is malformed even though it parses as a URL.
    expect(findPageIssues(signals({ canonical: 'javascript:alert(1)' }), PAGE_URL, SITE_HOST)).toContain('canonical-malformed');
    expect(findPageIssues(signals({ canonical: 'https://other.com/pricing' }), PAGE_URL, SITE_HOST)).toContain('canonical-cross-domain');
    // www. stripped, case-insensitive.
    expect(findPageIssues(signals({ canonical: 'https://WWW.acme.com/pricing' }), PAGE_URL, SITE_HOST)).not.toContain('canonical-cross-domain');
    // Same domain, different path — pagination/faceted nav, not flagged.
    expect(findPageIssues(signals({ canonical: 'https://acme.com/pricing?ref=footer' }), PAGE_URL, SITE_HOST).some((i) => i.startsWith('canonical'))).toBe(false);
  });

  it('url issues stack — not mutually exclusive', () => {
    const longUpperUnderscore = 'https://acme.com/' + 'A_B'.repeat(50) + '?a=1&b=2&c=3&d=4';
    const issues = findPageIssues(signals(), longUpperUnderscore, SITE_HOST);
    expect(issues).toContain('url-too-long');
    expect(issues).toContain('url-has-uppercase');
    expect(issues).toContain('url-has-underscore');
    expect(issues).toContain('url-excess-params');
  });

  it('json-ld: missing vs invalid', () => {
    expect(findPageIssues(signals({ jsonLdCount: 0 }), PAGE_URL, SITE_HOST)).toContain('json-ld-missing');
    expect(findPageIssues(signals({ jsonLdCount: 1, jsonLdValid: false }), PAGE_URL, SITE_HOST)).toContain('json-ld-invalid');
  });

  it('thin-content below the word floor', () => {
    expect(findPageIssues(signals({ wordCount: 50 }), PAGE_URL, SITE_HOST)).toContain('thin-content');
    expect(findPageIssues(signals({ wordCount: 150 }), PAGE_URL, SITE_HOST)).not.toContain('thin-content');
  });

  it('alt coverage: only evaluated when there are images with missing alts, ratio or all-missing trips it', () => {
    expect(findPageIssues(signals({ imageCount: 10, imagesMissingAlt: 0 }), PAGE_URL, SITE_HOST)).not.toContain('images-missing-alt');
    // 20% missing — under the 25% ratio band, and not all images.
    expect(findPageIssues(signals({ imageCount: 10, imagesMissingAlt: 2 }), PAGE_URL, SITE_HOST)).not.toContain('images-missing-alt');
    // 30% — over the band.
    expect(findPageIssues(signals({ imageCount: 10, imagesMissingAlt: 3 }), PAGE_URL, SITE_HOST)).toContain('images-missing-alt');
    // A single image missing alt (100% of a tiny count) trips it regardless of the ratio band size.
    expect(findPageIssues(signals({ imageCount: 1, imagesMissingAlt: 1 }), PAGE_URL, SITE_HOST)).toContain('images-missing-alt');
  });
});

describe('scorePage', () => {
  it('is 100 minus the sum of deductions, clamped at 0', () => {
    expect(scorePage([])).toBe(100);
    expect(scorePage(['title-missing'])).toBe(80);
    expect(scorePage(['page-error'])).toBe(0);
    // Overlapping deductions stack past 100 worth of penalty, clamped, not floored at some other value.
    expect(scorePage(['title-missing', 'meta-missing', 'h1-missing', 'canonical-missing', 'thin-content', 'json-ld-missing'])).toBe(15);
  });
});

describe('findDuplicateContent', () => {
  it('flags every URL in a group sharing a hash, skips null hashes', () => {
    const pages = [
      { url: 'https://a.com/1', contentHash: 'x' },
      { url: 'https://a.com/2', contentHash: 'x' },
      { url: 'https://a.com/3', contentHash: 'y' },
      { url: 'https://a.com/4', contentHash: null },
      { url: 'https://a.com/5', contentHash: null },
    ];
    const dupes = findDuplicateContent(pages);
    expect(dupes.has('https://a.com/1')).toBe(true);
    expect(dupes.has('https://a.com/2')).toBe(true);
    expect(dupes.has('https://a.com/3')).toBe(false);
    expect(dupes.has('https://a.com/4')).toBe(false);
  });
});

describe('summarisePages', () => {
  function page(overrides: Partial<AuditPageResult> = {}): AuditPageResult {
    return {
      url: 'https://a.com/x',
      status: 200,
      lastmod: null,
      title: 'x',
      titleLength: 1,
      metaDescription: 'x',
      metaDescLength: 1,
      h1Count: 1,
      canonical: null,
      wordCount: 300,
      imageCount: 5,
      imagesMissingAlt: 1,
      jsonLdTypes: [],
      jsonLdValid: true,
      jsonLdCount: 1,
      issues: [],
      score: 100,
      ...overrides,
    };
  }

  it('excludes page-error pages from the average score', () => {
    const pages = [page({ score: 80 }), page({ score: 60 }), page({ score: 0, issues: ['page-error'] })];
    const summary = summarisePages(pages, 5, 150);
    expect(summary.averageScore).toBe(70); // (80+60)/2, error page excluded
    expect(summary.ok).toBe(2);
    expect(summary.errored).toBe(1);
  });

  it('sums image totals across every page regardless of flag status', () => {
    const pages = [page({ imageCount: 5, imagesMissingAlt: 1 }), page({ imageCount: 3, imagesMissingAlt: 0 })];
    const summary = summarisePages(pages, 2, 150);
    expect(summary.imagesTotal).toBe(8);
    expect(summary.imagesMissingAlt).toBe(1);
  });

  it('counts URL-issue pages as distinct pages, not summed occurrences', () => {
    const pages = [page({ issues: ['url-too-long', 'url-has-uppercase'] }), page({ issues: [] })];
    const summary = summarisePages(pages, 2, 150);
    expect(summary.pagesWithUrlIssues).toBe(1);
  });
});
