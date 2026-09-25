import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { FetcherService } from '../../../fetcher/fetcher.service.js';
import { RobotsService } from '../../../fetcher/services/robots.service.js';
import type { AuditContext } from '../audit-context.js';
import { RobotsCheck } from './robots.check.js';

const CTX: AuditContext = { runId: 'run-1', project: { id: 'p1', name: 'Acme', domain: 'acme.com' }, targetUrl: 'https://acme.com/' };

function fetchResult(status: number, body: string) {
  return { url: '', finalUrl: '', status, statusText: '', headers: {}, body, timing: { latencyMs: 1 }, userAgent: '', cached: false, retryCount: 0 };
}

describe('RobotsCheck', () => {
  async function build(fetch: ReturnType<typeof vi.fn>, isAllowed: ReturnType<typeof vi.fn>) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RobotsCheck,
        { provide: FetcherService, useValue: { fetch } },
        { provide: RobotsService, useValue: { isAllowed } },
      ],
    }).compile();
    return moduleRef.get(RobotsCheck);
  }

  it('passes when robots.txt allows everything', async () => {
    const fetch = vi.fn().mockResolvedValue(fetchResult(200, 'User-agent: *\nAllow: /'));
    const isAllowed = vi.fn().mockResolvedValue(true);
    const check = await build(fetch, isAllowed);

    const finding = await check.run(CTX);

    expect(finding.status).toBe('pass');
    expect(finding.type).toBe('robots');
    expect(finding.confidence).toBe('confirmed');
  });

  it('reports missing robots.txt as a fail with no rules evaluated', async () => {
    const fetch = vi.fn().mockResolvedValue(fetchResult(404, ''));
    const isAllowed = vi.fn();
    const check = await build(fetch, isAllowed);

    const finding = await check.run(CTX);

    expect(finding.status).toBe('fail');
    expect(finding.recommendedFix).toContain('No robots.txt found');
    expect(isAllowed).not.toHaveBeenCalled(); // nothing to evaluate rules against
  });

  it('escalates to high severity when a search crawler is blocked at root, not just any bot', async () => {
    const fetch = vi.fn().mockResolvedValue(fetchResult(200, 'User-agent: PerplexityBot\nDisallow: /'));
    // Only the search crawler's UA resolves to blocked; everything else allowed.
    const isAllowed = vi.fn().mockImplementation(async (_url: string, ua = '*') => !ua.toLowerCase().includes('perplexitybot'));
    const check = await build(fetch, isAllowed);

    const finding = await check.run(CTX);

    expect(finding.status).toBe('fail');
    expect(finding.severity).toBe('high');
    expect(finding.recommendedFix).toContain('Search/index crawlers are BLOCKED');
    expect((finding.detail['blockedSearch'] as string[])).toContain('PerplexityBot');
  });

  it('does not count a path-specific disallow toward the blocked-bots headline', async () => {
    const fetch = vi.fn().mockResolvedValue(fetchResult(200, 'User-agent: GPTBot\nDisallow: /admin'));
    // isAllowed(root) is true — GPTBot is only blocked from /admin, not root.
    const isAllowed = vi.fn().mockResolvedValue(true);
    const check = await build(fetch, isAllowed);

    const finding = await check.run(CTX);

    expect(finding.status).toBe('pass');
    expect(finding.detail['blockedBots']).toEqual([]);
  });
});
