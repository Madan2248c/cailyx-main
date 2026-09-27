import { describe, expect, it, vi } from 'vitest';
import { FetcherService } from '../../fetcher/fetcher.service.js';
import { HomepageProfilerService } from './homepage-profiler.service.js';

describe('HomepageProfilerService', () => {
  it('returns a FAILED profile on a non-2xx status — never throws', async () => {
    const fetcher = { fetch: vi.fn().mockResolvedValue({ status: 403, statusText: 'Forbidden', headers: {}, body: '' }) } as unknown as FetcherService;
    const service = new HomepageProfilerService(fetcher);
    const profile = await service.profile('blocked.example.com');
    expect(profile.fetchStatus).toBe('FAILED');
    expect(profile.error).toContain('403');
    expect(profile.seoScore).toBeNull();
  });

  it('returns a FAILED profile when the fetch itself throws — never crashes the caller', async () => {
    const fetcher = { fetch: vi.fn().mockRejectedValue(new Error('DNS lookup failed')) } as unknown as FetcherService;
    const service = new HomepageProfilerService(fetcher);
    const profile = await service.profile('nonexistent.example.com');
    expect(profile.fetchStatus).toBe('FAILED');
    expect(profile.error).toContain('DNS lookup failed');
  });

  it('detects tech stack, schema types, and a real SEO score on a healthy fetch', async () => {
    const html = `<html><head>
      <title>A perfectly reasonable title for this page</title>
      <meta name="description" content="A perfectly reasonable meta description that is long enough to pass the rubric's minimum length band easily.">
      <link rel="canonical" href="https://example.com/">
      <script src="https://www.googletagmanager.com/gtm.js?id=GTM-X"></script>
      <script type="application/ld+json">{"@type":"Organization","name":"Example"}</script>
    </head><body><h1>Welcome</h1><p>Some real content here to give the page a reasonable word count for the rubric to score well against.</p></body></html>`;
    const fetcher = { fetch: vi.fn().mockResolvedValue({ status: 200, statusText: 'OK', headers: { server: 'cloudflare' }, body: html }) } as unknown as FetcherService;
    const service = new HomepageProfilerService(fetcher);
    const profile = await service.profile('example.com');

    expect(profile.fetchStatus).toBe('OK');
    expect(profile.techStackFindings.some((f) => f.name === 'Google Tag Manager')).toBe(true);
    expect(profile.techStackFindings.some((f) => f.name === 'Cloudflare')).toBe(true);
    expect(profile.schemaTypes).toContain('Organization');
    expect(profile.seoScore).not.toBeNull();
    expect(profile.seoScore).toBeGreaterThan(0);
  });

  it('normalizes a domain with protocol/www before fetching', async () => {
    const fetcher = { fetch: vi.fn().mockResolvedValue({ status: 200, statusText: 'OK', headers: {}, body: '<html></html>' }) } as unknown as FetcherService;
    const service = new HomepageProfilerService(fetcher);
    await service.profile('https://www.example.com/some/path');
    expect(fetcher.fetch).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com' }), expect.any(String));
  });
});
