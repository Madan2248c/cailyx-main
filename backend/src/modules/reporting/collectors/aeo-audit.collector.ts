import { Injectable } from '@nestjs/common';
import { AeoAuditService } from '../../aeo-audit/services/aeo-audit.service.js';
import type { AeoAuditSection } from '../reporting.types.js';

@Injectable()
export class AeoAuditReportCollector {
  constructor(private readonly aeoAudit: AeoAuditService) {}

  async collect(clientId: string, projectId: string): Promise<AeoAuditSection | null> {
    const audits = await this.aeoAudit.list(clientId, projectId);
    const latest = audits.find((a) => a.status === 'completed');
    if (!latest) return null;

    const verdict = await this.aeoAudit.getVerdict(clientId, latest.id);

    return {
      auditId: latest.id,
      overallMentionRate: verdict.counted.overall.mentionRate,
      overallCitationRate: verdict.counted.overall.citationRate,
      headlines: verdict.headlines,
      competitorStanding: verdict.counted.competitorStanding.map((c) => ({
        name: c.name,
        timesAhead: c.timesAhead,
        timesBehind: c.timesBehind,
        coMentions: c.coMentions,
      })),
      narrative: verdict.narrative,
    };
  }
}
