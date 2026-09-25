import { describe, expect, it } from 'vitest';
import { extractPageSignals } from './page-signals.js';

const URL = 'https://acme.com/pricing';
const HOST = 'acme.com';

describe('extractPageSignals', () => {
  it('extracts title, meta description (with og: fallback), canonical, and noindex', () => {
    const html = `<html><head>
      <title>Pricing — Acme</title>
      <meta name="description" content="Simple pricing.">
      <link rel="canonical" href="https://acme.com/pricing">
      <meta name="robots" content="index, noindex">
    </head><body></body></html>`;
    const s = extractPageSignals(html, 200, URL, HOST);
    expect(s.title).toBe('Pricing — Acme');
    expect(s.metaDescription).toBe('Simple pricing.');
    expect(s.canonical).toBe('https://acme.com/pricing');
    expect(s.noindex).toBe(true);
  });

  it('falls back to og:description when meta description is absent', () => {
    const html = '<html><head><meta property="og:description" content="OG desc."></head></html>';
    expect(extractPageSignals(html, 200, URL, HOST).metaDescription).toBe('OG desc.');
  });

  it('extracts heading levels in document order and h1Count separately', () => {
    const html = '<body><h1>Title</h1><h2>A</h2><h3>B</h3><h2>C</h2></body>';
    const s = extractPageSignals(html, 200, URL, HOST);
    expect(s.headingLevels).toEqual([1, 2, 3, 2]);
    expect(s.h1Count).toBe(1);
  });

  it('counts words after stripping script/style/noscript/svg from the body', () => {
    const html = '<body><p>one two three</p><script>var x = "should not count as words here";</script><style>.a{color:red}</style></body>';
    const s = extractPageSignals(html, 200, URL, HOST);
    expect(s.wordCount).toBe(3);
  });

  it('excludes decorative images from counts entirely', () => {
    const html = `<body>
      <img src="a.png" alt="">
      <img src="b.png" aria-hidden="true">
      <img src="c.png" role="presentation">
      <img src="d.png" width="1" height="1">
      <img src="real.png">
    </body>`;
    const s = extractPageSignals(html, 200, URL, HOST);
    expect(s.imageCount).toBe(1);
    expect(s.imagesMissingAlt).toBe(1); // the real image has no alt attribute at all
  });

  it('alt="" is not "missing alt" — only a wholly absent attribute counts', () => {
    const html = '<body><img src="a.png" alt=""></body>';
    // alt="" makes the image decorative (excluded from counts entirely), not "missing".
    const s = extractPageSignals(html, 200, URL, HOST);
    expect(s.imageCount).toBe(0);
    expect(s.imagesMissingAlt).toBe(0);
  });

  it('extracts JSON-LD types, walking @graph nesting', () => {
    const html = `<script type="application/ld+json">
      {"@graph": [{"@type": "Organization", "name": "Acme"}, {"@type": ["Product", "Offer"]}]}
    </script>`;
    const s = extractPageSignals(html, 200, URL, HOST);
    expect(s.jsonLdCount).toBe(1);
    expect(s.jsonLdValid).toBe(true);
    expect(s.jsonLdTypes.sort()).toEqual(['Offer', 'Organization', 'Product'].sort());
  });

  it('marks jsonLdValid false on malformed JSON, but still counts the block', () => {
    const html = '<script type="application/ld+json">{not valid json</script>';
    const s = extractPageSignals(html, 200, URL, HOST);
    expect(s.jsonLdCount).toBe(1);
    expect(s.jsonLdValid).toBe(false);
  });

  it('reports zero JSON-LD when there are no script blocks at all', () => {
    const s = extractPageSignals('<body>hi</body>', 200, URL, HOST);
    expect(s.jsonLdCount).toBe(0);
    expect(s.jsonLdValid).toBe(false);
  });

  it('computes a content fingerprint from the stripped visible text', () => {
    const a = extractPageSignals('<body><p>Same content here</p></body>', 200, URL, HOST);
    const b = extractPageSignals('<body><p>Same content here</p><script>ignored</script></body>', 200, URL, HOST);
    expect(a.contentHash).toBe(b.contentHash);
  });
});
