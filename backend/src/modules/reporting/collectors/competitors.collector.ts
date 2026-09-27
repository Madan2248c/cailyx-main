import { Injectable } from '@nestjs/common';
import { CompetitorsService } from '../../competitors/services/competitors.service.js';
import type { CompetitorsSection } from '../reporting.types.js';

@Injectable()
export class CompetitorsReportCollector {
  constructor(private readonly competitors: CompetitorsService) {}

  async collect(clientId: string, projectId: string): Promise<CompetitorsSection | null> {
    const gap = await this.competitors.getGap(clientId, projectId);
    if (!gap.own.profile && gap.competitors.length === 0) return null;

    return {
      own: { name: gap.own.name, domain: gap.own.domain, seoScore: gap.own.profile?.seoScore ?? null },
      rows: gap.competitors.map((c) => ({
        name: c.name,
        domain: c.domain,
        seoScore: c.profile?.seoScore ?? null,
        reviewRating: (c.profile?.reviewRating as { source: string; rating: number; count: number | null } | null) ?? null,
        aeoStanding: c.aeoStanding ? { timesAhead: c.aeoStanding.timesAhead, timesBehind: c.aeoStanding.timesBehind, coMentions: c.aeoStanding.coMentions } : null,
      })),
    };
  }
}
