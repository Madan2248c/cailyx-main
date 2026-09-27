/**
 * Technical Audit collector — reads the project's latest COMPLETE run via
 * `TechnicalAuditService`'s own exported read methods (no direct DB
 * access) and flattens it into citable `SourceFinding`s: one per check
 * finding (including its `recommendedFix` — Technical Audit's checks do
 * already write a per-finding fix suggestion, contrary to this module's
 * own design doc's premise; kept as grounding text regardless, since
 * Gap Analysis's value is the cross-source merge + single ranked list,
 * not whether a source already suggests something in isolation), plus
 * the composite score and narrative as two more citable rows.
 *
 * @module gap-analysis/collectors/technical-audit.collector
 */

import { Injectable } from '@nestjs/common';
import { TechnicalAuditService } from '../../technical-audit/services/technical-audit.service.js';
import type { AuditFinding } from '../../technical-audit/technical-audit.types.js';
import type { CollectedSource, SourceFinding } from '../gap-analysis.types.js';

@Injectable()
export class TechnicalAuditCollector {
  constructor(private readonly technicalAudit: TechnicalAuditService) {}

  async collect(clientId: string, projectId: string): Promise<CollectedSource | null> {
    const runs = await this.technicalAudit.listRuns(clientId, projectId);
    const latest = runs.find((r) => r.status === 'COMPLETE');
    if (!latest) return null;

    const findings: SourceFinding[] = ((latest.findings as unknown as AuditFinding[]) ?? []).map((f) => ({
      module: 'technical-audit',
      findingRef: f.type,
      summary: `[${f.status}/${f.severity}] ${f.type}: ${f.recommendedFix}`,
    }));

    if (latest.score != null) {
      findings.push({ module: 'technical-audit', findingRef: 'composite-score', summary: `Composite technical/SEO score: ${latest.score}/100.` });
    }
    if (latest.narrative) {
      findings.push({ module: 'technical-audit', findingRef: 'narrative', summary: `Audit commentary: ${latest.narrative}` });
    }

    return { module: 'technical-audit', runId: latest.id, findings };
  }
}
