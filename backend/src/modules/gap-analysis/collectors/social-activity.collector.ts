/**
 * Social Activity collector — reads the project's latest COMPLETE run via
 * `SocialActivityService`'s own exported read methods and flattens it
 * into citable `SourceFinding`s: one per platform finding, plus one per
 * run-over-run delta (Social Activity itself states "no recommendations"
 * — these are raw facts, not suggestions, exactly the grounding material
 * Gap Analysis is meant to turn into an action item).
 *
 * @module gap-analysis/collectors/social-activity.collector
 */

import { Injectable } from '@nestjs/common';
import { SocialActivityService } from '../../social-activity/services/social-activity.service.js';
import type { SocialActivityDelta, SocialActivityFinding } from '../../social-activity/social-activity.types.js';
import type { CollectedSource, SourceFinding } from '../gap-analysis.types.js';

@Injectable()
export class SocialActivityCollector {
  constructor(private readonly socialActivity: SocialActivityService) {}

  async collect(clientId: string, projectId: string): Promise<CollectedSource | null> {
    const runs = await this.socialActivity.listRuns(clientId, projectId);
    const latest = runs.find((r) => r.status === 'COMPLETE');
    if (!latest) return null;

    const findings: SourceFinding[] = ((latest.findings as unknown as SocialActivityFinding[]) ?? []).map((f) => ({
      module: 'social-activity',
      findingRef: `${f.platform}:${f.type}`,
      summary: `[${f.status}/${f.severity}] ${f.platform}: ${f.detail}`,
    }));

    for (const d of (latest.deltas as unknown as SocialActivityDelta[]) ?? []) {
      findings.push({
        module: 'social-activity',
        findingRef: `delta:${d.platform}:${d.metric}`,
        summary: `${d.platform} ${d.metric} changed from ${d.previous ?? 'n/a'} to ${d.current ?? 'n/a'}.`,
      });
    }

    return { module: 'social-activity', runId: latest.id, findings };
  }
}
