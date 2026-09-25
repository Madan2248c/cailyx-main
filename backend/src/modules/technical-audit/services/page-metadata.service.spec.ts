import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FetcherService } from '../../fetcher/fetcher.service.js';
import type { AuditContext } from './audit-context.js';
import { PageMetadataService } from './page-metadata.service.js';

const CTX: AuditContext = { runId: 'run-1', project: { id: 'p1', name: 'Acme', domain: 'acme.com' }, targetUrl: 'https://acme.com' };

function fetchResult(body: string) {
  return { url: CTX.targetUrl, finalUrl: CTX.targetUrl, status: 200, statusText: 'OK', headers: {}, body, timing: { latencyMs: 1 }, userAgent: 'test', cached: false, retryCount: 0 };
}

describe('PageMetadataService', () => {
  let service: PageMetadataService;
  let fetcher: { fetch: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    fetcher = { fetch: vi.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [PageMetadataService, { provide: FetcherService, useValue: fetcher }],
    }).compile();
    service = moduleRef.get(PageMetadataService);
  });

  it('extracts title, meta description (falling back to og:description), and headings in document order', async () => {
    fetcher.fetch.mockResolvedValue(
      fetchResult(`
        <html><head><title> Acme — Home </title>
        <meta property="og:description" content="OG fallback description text here.">
        </head><body>
        <h1>Welcome to Acme</h1>
        <h2>Our services</h2>
        </body></html>
      `),
    );

    const meta = await service.capture(CTX);

    expect(meta.title).toBe('Acme — Home');
    expect(meta.metaDescription).toBe('OG fallback description text here.');
    expect(meta.headings).toEqual([
      { level: 1, text: 'Welcome to Acme' },
      { level: 2, text: 'Our services' },
    ]);
  });

  it('prefers the standard meta description over og:description when both exist', async () => {
    fetcher.fetch.mockResolvedValue(
      fetchResult('<html><head><meta name="description" content="Standard desc"><meta property="og:description" content="OG desc"></head><body></body></html>'),
    );

    const meta = await service.capture(CTX);

    expect(meta.metaDescription).toBe('Standard desc');
  });

  it('skips headings with no text', async () => {
    fetcher.fetch.mockResolvedValue(fetchResult('<html><body><h1></h1><h2>Real heading</h2></body></html>'));

    const meta = await service.capture(CTX);

    expect(meta.headings).toEqual([{ level: 2, text: 'Real heading' }]);
  });

  describe('positioningCopy fallback chain', () => {
    it('uses the first <p> sibling after the H1 when it is long enough', async () => {
      fetcher.fetch.mockResolvedValue(
        fetchResult('<html><body><h1>Acme</h1><p>This is a real positioning paragraph, quite long.</p></body></html>'),
      );

      const meta = await service.capture(CTX);

      expect(meta.positioningCopy).toBe('This is a real positioning paragraph, quite long.');
    });

    it('skips a too-short sibling paragraph and falls back to the first long <p> anywhere', async () => {
      fetcher.fetch.mockResolvedValue(
        fetchResult('<html><body><h1>Acme</h1><p>short</p><div><p>A different, sufficiently long paragraph elsewhere.</p></div></body></html>'),
      );

      const meta = await service.capture(CTX);

      expect(meta.positioningCopy).toBe('A different, sufficiently long paragraph elsewhere.');
    });

    it('falls back to the H1 text itself when no paragraph is long enough', async () => {
      fetcher.fetch.mockResolvedValue(fetchResult('<html><body><h1>Acme Home</h1><p>short</p></body></html>'));

      const meta = await service.capture(CTX);

      expect(meta.positioningCopy).toBe('Acme Home');
    });

    it('returns an empty string when there is no H1 and no long paragraph', async () => {
      fetcher.fetch.mockResolvedValue(fetchResult('<html><body><p>short</p></body></html>'));

      const meta = await service.capture(CTX);

      expect(meta.positioningCopy).toBe('');
    });

    it('does not use a <p> that comes before the H1 as the "sibling after" candidate', async () => {
      fetcher.fetch.mockResolvedValue(
        fetchResult('<html><body><p>A paragraph before the heading, plenty long enough here.</p><h1>Acme</h1></body></html>'),
      );

      const meta = await service.capture(CTX);

      // Falls through to tier 2 (first long <p> anywhere), which is this same
      // paragraph — the point is it's reached via the right tier, not tier 1.
      expect(meta.positioningCopy).toBe('A paragraph before the heading, plenty long enough here.');
    });
  });

  it('fetches with a 1 hour cache TTL', async () => {
    fetcher.fetch.mockResolvedValue(fetchResult('<html></html>'));

    await service.capture(CTX);

    expect(fetcher.fetch).toHaveBeenCalledWith({ url: CTX.targetUrl, cacheTtlSeconds: 3600 }, 'technical-audit', CTX.runId);
  });
});
