import { Injectable } from '@nestjs/common';
import { GapAnalysisService } from '../../gap-analysis/services/gap-analysis.service.js';
import type { GapAnalysisSection } from '../reporting.types.js';

@Injectable()
export class GapAnalysisReportCollector {
  constructor(private readonly gapAnalysis: GapAnalysisService) {}

  async collect(clientId: string, projectId: string): Promise<GapAnalysisSection | null> {
    const runs = await this.gapAnalysis.listRuns(clientId, projectId);
    const latest = runs.find((r) => r.status === 'COMPLETE');
    if (!latest) return null;

    const full = await this.gapAnalysis.getRun(clientId, latest.id);
    const recommendations = (full as { recommendations?: Array<{ priorityRank: number; title: string; description: string; status: string }> }).recommendations ?? [];

    return {
      runId: latest.id,
      recommendations: recommendations.map((r) => ({ rank: r.priorityRank, title: r.title, description: r.description, status: r.status })),
    };
  }
}
