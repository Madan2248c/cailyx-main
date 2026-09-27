import { Injectable } from '@nestjs/common';
import { TechnicalAuditService } from '../../technical-audit/services/technical-audit.service.js';
import type { AuditFinding } from '../../technical-audit/technical-audit.types.js';
import type { TechnicalAuditSection } from '../reporting.types.js';

@Injectable()
export class TechnicalAuditCollector {
  constructor(private readonly technicalAudit: TechnicalAuditService) {}

  async collect(clientId: string, projectId: string): Promise<TechnicalAuditSection | null> {
    const runs = await this.technicalAudit.listRuns(clientId, projectId);
    const latest = runs.find((r) => r.status === 'COMPLETE');
    if (!latest) return null;

    return {
      runId: latest.id,
      score: latest.score,
      findings: ((latest.findings as unknown as AuditFinding[]) ?? []).map((f) => ({
        type: f.type,
        status: f.status,
        severity: f.severity,
        recommendedFix: f.recommendedFix,
      })),
      narrative: latest.narrative,
    };
  }
}
