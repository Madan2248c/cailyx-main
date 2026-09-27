import { Injectable } from '@nestjs/common';
import { SocialActivityService } from '../../social-activity/services/social-activity.service.js';
import type { PlatformActivity, SocialActivityFinding } from '../../social-activity/social-activity.types.js';
import type { SocialActivitySection } from '../reporting.types.js';

@Injectable()
export class SocialActivityCollector {
  constructor(private readonly socialActivity: SocialActivityService) {}

  async collect(clientId: string, projectId: string): Promise<SocialActivitySection | null> {
    const runs = await this.socialActivity.listRuns(clientId, projectId);
    const latest = runs.find((r) => r.status === 'COMPLETE');
    if (!latest) return null;

    const platforms = ((latest.result as unknown as { platforms?: PlatformActivity[] })?.platforms ?? []).map((p) => ({
      platform: p.platform,
      pattern: p.pattern,
      postsInWindow: p.postsInWindow,
      followerCount: p.followerCount,
      avgEngagement: p.avgEngagement,
    }));

    return {
      runId: latest.id,
      platforms,
      findings: ((latest.findings as unknown as SocialActivityFinding[]) ?? []).map((f) => ({
        type: f.type,
        platform: f.platform,
        status: f.status,
        severity: f.severity,
        detail: f.detail,
      })),
    };
  }
}
