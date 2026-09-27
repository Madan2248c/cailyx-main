/**
 * Executive summary — one LLM call, same "never invent a number, only
 * describe cited ones" discipline as AEO Audit's narrative. Reads the
 * already-assembled sections; never re-derives a number itself.
 *
 * @module reporting/services/report-narrative.service
 */

import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../llm/llm.service.js';
import { NARRATIVE_MAX_TOKENS } from '../reporting.constants.js';
import type { CollectedSections } from './report-content.js';
import type { ReportDelta } from '../reporting.types.js';

const SYSTEM = `You write the executive summary for a client audit report — 3-5 sentences, direct and evidence-led, no hedging.

Rules:
- Never state a number, percentage, or count that isn't already given to you below.
- Cite the most important 2-3 findings across every section you're given — never invent a finding.
- If deltas are given, lead with the most significant movement ("X went from A to B").
- Plain prose, no headers, no bullet points.

Respond with ONLY JSON: {"summary": string}`;

@Injectable()
export class ReportNarrativeService {
  private readonly logger = new Logger(ReportNarrativeService.name);

  constructor(private readonly llm: LlmService) {}

  async write(sections: CollectedSections, deltas: ReportDelta[] | null): Promise<{ summary: string; model: string }> {
    const lines: string[] = [];
    if (sections.technicalAudit) {
      lines.push(`Technical Audit: score ${sections.technicalAudit.score ?? 'n/a'}/100. Findings: ${sections.technicalAudit.findings.map((f) => `${f.type}(${f.status})`).join(', ') || 'none'}.`);
    }
    if (sections.socialActivity) {
      lines.push(`Social Activity: ${sections.socialActivity.findings.map((f) => `${f.platform}:${f.type}(${f.status})`).join(', ') || 'no findings'}.`);
    }
    if (sections.aeoAudit) {
      lines.push(`AEO Audit: mention rate ${(sections.aeoAudit.overallMentionRate * 100).toFixed(0)}%, citation rate ${(sections.aeoAudit.overallCitationRate * 100).toFixed(0)}%. Headlines: ${sections.aeoAudit.headlines.join(' ')}`);
    }
    if (sections.competitors) {
      lines.push(`Competitors: own SEO score ${sections.competitors.own.seoScore ?? 'n/a'}. ${sections.competitors.rows.length} tracked.`);
    }
    if (sections.gapAnalysis) {
      lines.push(`Gap Analysis top recommendations: ${sections.gapAnalysis.recommendations.slice(0, 3).map((r) => r.title).join('; ')}.`);
    }
    if (deltas && deltas.length > 0) {
      lines.push(`Deltas since last report: ${deltas.map((d) => `${d.module}.${d.metric}: ${d.previous} -> ${d.current}`).join(', ')}.`);
    }

    const result = await this.llm.json<string>(
      { system: SYSTEM, user: lines.join('\n'), maxTokens: NARRATIVE_MAX_TOKENS, purpose: 'reporting-executive-summary' },
      (raw) => validate(raw),
    );
    return { summary: result.data, model: result.model };
  }
}

function validate(raw: unknown): string {
  const summary = (raw as { summary?: unknown }).summary;
  if (typeof summary !== 'string' || !summary.trim()) throw new Error('executive summary was empty');
  return summary.trim();
}
