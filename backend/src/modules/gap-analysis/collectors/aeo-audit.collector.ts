/**
 * AEO Audit collector — reads the project's latest completed audit via
 * `AeoAuditService.list`/`getVerdict` (recomputed fresh, no cached-blob
 * trust) and flattens headlines, competitor standing, and losing prompts
 * into citable `SourceFinding`s. AEO Audit's own narrative is explicitly
 * forbidden from inventing recommendations — this collector reads the
 * same underlying verdict data the narrative describes, never the
 * narrative's prose itself as a citable fact (prose isn't a stable ref).
 *
 * @module gap-analysis/collectors/aeo-audit.collector
 */

import { Injectable } from '@nestjs/common';
import { AeoAuditService } from '../../aeo-audit/services/aeo-audit.service.js';
import { MAX_COMPETITOR_ROWS, MAX_HEADLINES, MAX_LOSING_PROMPT_ROWS } from '../gap-analysis.constants.js';
import type { CollectedSource, SourceFinding } from '../gap-analysis.types.js';

@Injectable()
export class AeoAuditCollector {
  constructor(private readonly aeoAudit: AeoAuditService) {}

  async collect(clientId: string, projectId: string): Promise<CollectedSource | null> {
    const audits = await this.aeoAudit.list(clientId, projectId);
    const latest = audits.find((a) => a.status === 'completed');
    if (!latest) return null;

    const verdict = await this.aeoAudit.getVerdict(clientId, latest.id);
    const findings: SourceFinding[] = [];

    verdict.headlines.slice(0, MAX_HEADLINES).forEach((h, i) => {
      findings.push({ module: 'aeo-audit', findingRef: `headline:${i}`, summary: h });
    });

    for (const c of verdict.counted.competitorStanding.slice(0, MAX_COMPETITOR_ROWS)) {
      findings.push({
        module: 'aeo-audit',
        findingRef: `competitor:${c.name}`,
        summary: `Vs. ${c.name}: subject ahead ${c.timesAhead}x, behind ${c.timesBehind}x, co-mentioned ${c.coMentions}x.`,
      });
    }

    for (const p of (verdict.judged?.losingPrompts ?? []).slice(0, MAX_LOSING_PROMPT_ROWS)) {
      findings.push({
        module: 'aeo-audit',
        findingRef: `losing-prompt:${p.observationId}`,
        summary: `Prompt "${p.prompt}" lost to: ${p.losesTo.join(', ')}.`,
      });
    }

    return { module: 'aeo-audit', runId: latest.id, findings };
  }
}
