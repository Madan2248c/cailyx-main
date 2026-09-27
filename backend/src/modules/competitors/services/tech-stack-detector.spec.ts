import { describe, expect, it } from 'vitest';
import { detectTechStack } from './tech-stack-detector.js';

describe('detectTechStack', () => {
  it('matches a script-src signature', () => {
    const html = '<html><head><script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC123"></script></head></html>';
    const findings = detectTechStack({}, html);
    expect(findings.some((f) => f.name === 'Google Tag Manager')).toBe(true);
  });

  it('matches a generator meta tag', () => {
    const html = '<html><head><meta name="generator" content="WordPress 6.4"></head></html>';
    const findings = detectTechStack({}, html);
    expect(findings.some((f) => f.name === 'WordPress')).toBe(true);
  });

  it('matches against every header VALUE, not one named key — CDN identity varies by vendor', () => {
    const findings = detectTechStack({ server: 'cloudflare', 'x-custom': 'irrelevant' }, '<html></html>');
    expect(findings.some((f) => f.name === 'Cloudflare')).toBe(true);
  });

  it('records the matched evidence, truncated', () => {
    const html = '<script src="https://static.hotjar.com/c/hotjar-123.js"></script>';
    const findings = detectTechStack({}, html);
    const hotjar = findings.find((f) => f.name === 'Hotjar');
    expect(hotjar?.evidence[0]).toContain('hotjar');
  });

  it('finds nothing on a page with none of the signals', () => {
    expect(detectTechStack({}, '<html><body>Plain page</body></html>')).toEqual([]);
  });

  it('can match multiple signatures on one page', () => {
    const html = `
      <html><head>
        <meta name="generator" content="Webflow">
        <script src="https://www.googletagmanager.com/gtm.js?id=GTM-X"></script>
      </head></html>`;
    const findings = detectTechStack({}, html);
    expect(findings.map((f) => f.name)).toEqual(expect.arrayContaining(['Webflow', 'Google Tag Manager']));
  });
});
