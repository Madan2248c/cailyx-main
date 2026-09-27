import { describe, expect, it, vi } from 'vitest';
import { SocialActivityService } from '../../social-activity/services/social-activity.service.js';
import { SocialActivityCollector } from './social-activity.collector.js';

describe('SocialActivityCollector', () => {
  it('returns null when no run is COMPLETE', async () => {
    const service = { listRuns: vi.fn().mockResolvedValue([]) } as unknown as SocialActivityService;
    const collector = new SocialActivityCollector(service);
    expect(await collector.collect('client-1', 'project-1')).toBeNull();
  });

  it('flattens findings + deltas from the latest COMPLETE run', async () => {
    const service = {
      listRuns: vi.fn().mockResolvedValue([
        {
          id: 'r1',
          status: 'COMPLETE',
          findings: [{ type: 'dormant-platform', platform: 'linkedin', status: 'fail', severity: 'warn', detail: 'No posts in window.' }],
          deltas: [{ platform: 'linkedin', metric: 'followers', previous: 100, current: 120 }],
        },
      ]),
    } as unknown as SocialActivityService;
    const collector = new SocialActivityCollector(service);
    const result = await collector.collect('client-1', 'project-1');
    expect(result!.findings).toContainEqual({ module: 'social-activity', findingRef: 'linkedin:dormant-platform', summary: '[fail/warn] linkedin: No posts in window.' });
    expect(result!.findings).toContainEqual({ module: 'social-activity', findingRef: 'delta:linkedin:followers', summary: 'linkedin followers changed from 100 to 120.' });
  });
});
