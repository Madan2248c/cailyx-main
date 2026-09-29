import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveDataforseoAdapter, normalizeTarget } from './live.adapter.js';

const config = (values: Record<string, string>) => ({ get: (k: string) => values[k] }) as unknown as ConfigService;
const ON = { DATAFORSEO_LIVE: '1', DATAFORSEO_LOGIN: 'login', DATAFORSEO_PASSWORD: 'secret' };

const ok = (result: unknown[], cost = 0.02) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: async () => ({ status_code: 20000, cost, tasks: [{ status_code: 20000, cost, result }] }),
});

describe('LiveDataforseoAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is only enabled with the switch and both credentials', () => {
    expect(LiveDataforseoAdapter.isEnabled(config(ON))).toBe(true);
    expect(LiveDataforseoAdapter.isEnabled(config({ ...ON, DATAFORSEO_LIVE: '0' }))).toBe(false);
    expect(LiveDataforseoAdapter.isEnabled(config({ DATAFORSEO_LIVE: '1', DATAFORSEO_LOGIN: 'l' }))).toBe(false);
  });

  it('refuses to fetch when not enabled, without touching the network', async () => {
    const adapter = new LiveDataforseoAdapter(config({}));
    await expect(adapter.fetchDataset('backlinks-summary', 'faydo.in')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes a domain to a bare host', () => {
    expect(normalizeTarget('https://www.Faydo.in/path?x=1')).toBe('faydo.in');
  });

  it('maps referring domains and sends basic auth without leaking it into the payload', async () => {
    fetchMock.mockResolvedValueOnce(ok([{ items: [{ domain: 'a.com', backlinks: 5, first_seen: '2025-01-02 03:04:05 +00:00' }] }]));
    const res = await new LiveDataforseoAdapter(config(ON)).fetchDataset('referring-domains', 'faydo.in');
    expect(res.payload).toMatchObject({ dataset: 'referring-domains', domains: [{ domain: 'a.com', backlinks: 5 }] });
    expect(res.costUsd).toBeCloseTo(0.02);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('backlinks/referring_domains/live');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('login:secret').toString('base64')}`);
    expect(JSON.stringify(res)).not.toContain('secret');
  });

  it('lists only pages that actually have links, most linked first', async () => {
    fetchMock.mockResolvedValueOnce(
      ok([
        {
          items: [
            { page: 'https://faydo.in/faq', page_summary: { backlinks: 0, referring_domains: 0 } },
            { page: 'https://faydo.in/', page_summary: { backlinks: 25, referring_domains: 25 } },
            { page: 'https://faydo.in/privacy', page_summary: { backlinks: 3, referring_domains: 1 } },
          ],
        },
      ]),
    );
    const res = await new LiveDataforseoAdapter(config(ON)).fetchDataset('top-pages', 'faydo.in');
    expect(res.payload).toMatchObject({
      pages: [
        { url: 'https://faydo.in/', backlinks: 25 },
        { url: 'https://faydo.in/privacy', backlinks: 3 },
      ],
    });
  });

  it('handles a domain with no data (null items) as empty, not an error', async () => {
    fetchMock.mockResolvedValueOnce(ok([{ items: null, total_count: 0 }]));
    const res = await new LiveDataforseoAdapter(config(ON)).fetchDataset('backlink-rows', 'new-site.in');
    expect(res.payload).toMatchObject({ dataset: 'backlink-rows', backlinks: [] });
  });

  it('shares one ranked-keywords call across datasets and bills it once', async () => {
    fetchMock.mockResolvedValue(
      ok([
        {
          items: [
            {
              keyword_data: { keyword: 'deals app', keyword_info: { search_volume: 900, cpc: 0.4 }, keyword_properties: { keyword_difficulty: 22 } },
              ranked_serp_element: { serp_item: { rank_absolute: 7, url: 'https://faydo.in/', rank_changes: { previous_rank_absolute: 9 } } },
            },
          ],
        },
      ]),
    );
    const adapter = new LiveDataforseoAdapter(config(ON));
    const ranks = await adapter.fetchDataset('serp-ranks', 'faydo.in');
    const overview = await adapter.fetchDataset('keyword-overview', 'faydo.in');
    expect(ranks.payload).toMatchObject({ rankings: [{ keyword: 'deals app', position: 7, prevPosition: 9, volume: 900 }] });
    expect(overview.payload).toMatchObject({ keywords: [{ keyword: 'deals app', volume: 900, difficulty: 22, cpc: 0.4 }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(overview.costUsd).toBe(0);
  });

  it('turns an API error into a 503 that carries no credentials', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', json: async () => ({ status_code: 20000, tasks: [{ status_code: 40201, status_message: 'Payment Required' }] }) });
    const err = await new LiveDataforseoAdapter(config(ON)).fetchDataset('top-pages', 'faydo.in').catch((e: Error) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as Error).message).toContain('40201');
    expect((err as Error).message).not.toContain('secret');
  });
});
