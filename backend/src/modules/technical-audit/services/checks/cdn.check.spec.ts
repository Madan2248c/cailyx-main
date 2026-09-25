import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { FetcherService } from '../../../fetcher/fetcher.service.js';
import type { AuditContext } from '../audit-context.js';
import { CdnCheck } from './cdn.check.js';

const CTX: AuditContext = { runId: 'run-1', project: { id: 'p1', name: 'Acme', domain: 'acme.com' }, targetUrl: 'https://acme.com/' };

function fetchResult(status: number, headers: Record<string, string> = {}) {
  return { url: '', finalUrl: '', status, statusText: '', headers, body: '', timing: { latencyMs: 1 }, userAgent: '', cached: false, retryCount: 0 };
}

function probeResult(status: number, blocked: boolean, inconsistent = false) {
  return { url: '', botName: '', userAgent: '', status, blocked, latencyMs: 5, attempts: [], inconsistent };
}

describe('CdnCheck', () => {
  async function build(fetch: ReturnType<typeof vi.fn>, probe: ReturnType<typeof vi.fn>) {
    const moduleRef = await Test.createTestingModule({
      providers: [CdnCheck, { provide: FetcherService, useValue: { fetch, probe } }],
    }).compile();
    return moduleRef.get(CdnCheck);
  }

  it('passes when the browser control succeeds and no bot is blocked', async () => {
    const fetch = vi.fn().mockResolvedValue(fetchResult(200));
    const probe = vi.fn().mockResolvedValue(probeResult(200, false));
    const check = await build(fetch, probe);

    const finding = await check.run(CTX);

    expect(finding.status).toBe('pass');
    expect(finding.confidence).toBe('inferred');
    expect((finding.detail['silentBlockDetected'])).toBe(false);
  });

  it('flags a silent block only when the browser control itself succeeded', async () => {
    const fetch = vi.fn().mockResolvedValue(fetchResult(200));
    const probe = vi.fn().mockResolvedValue(probeResult(403, true));
    const check = await build(fetch, probe);

    const finding = await check.run(CTX);

    expect(finding.status).toBe('fail');
    expect(finding.detail['silentBlockDetected']).toBe(true);
    expect((finding.detail['blockedBots'] as string[]).length).toBeGreaterThan(0);
  });

  it('does not report a silent block when the browser control itself failed', async () => {
    // Site is just down / blocking everything, including a plain browser — not a targeted bot block.
    const fetch = vi.fn().mockResolvedValue(fetchResult(500));
    const probe = vi.fn().mockResolvedValue(probeResult(500, true));
    const check = await build(fetch, probe);

    const finding = await check.run(CTX);

    expect(finding.detail['silentBlockDetected']).toBe(false);
    expect(finding.detail['blockedBots']).toEqual([]);
  });

  it('detects Cloudflare from the cf-ray header', async () => {
    const fetch = vi.fn().mockResolvedValue(fetchResult(200, { 'cf-ray': 'abc123' }));
    const probe = vi.fn().mockResolvedValue(probeResult(200, false));
    const check = await build(fetch, probe);

    const finding = await check.run(CTX);

    expect(finding.detail['cdnVendor']).toBe('Cloudflare');
  });

  it('probes every bot in batches, not one request at a time serially forever', async () => {
    const fetch = vi.fn().mockResolvedValue(fetchResult(200));
    const probe = vi.fn().mockResolvedValue(probeResult(200, false));
    const check = await build(fetch, probe);

    await check.run(CTX);

    // Every probeable bot got probed exactly once.
    expect(probe.mock.calls.length).toBeGreaterThan(15);
    expect(probe.mock.calls[0]![0]).toMatchObject({ repeat: 3, retries: 1 });
  });
});
