/**
 * One LLM call: given every collected source finding, produce a ranked,
 * merged list of concrete next steps. The only place in this module that
 * calls an LLM — everything downstream (`gap-analysis.guardrails.ts`) is
 * deterministic validation of what comes back.
 *
 * @module gap-analysis/services/gap-analysis-generation.service
 */

import { Injectable } from '@nestjs/common';
import { LlmService } from '../../llm/llm.service.js';
import { CONSOLIDATE_MAX_TOKENS } from '../gap-analysis.constants.js';
import type { RawRecommendation, SourceFinding, SourceModule } from '../gap-analysis.types.js';

const SYSTEM = `You consolidate findings from multiple audit modules into ONE ranked list of concrete next steps for a business.

You will be given a flat list of findings, each with a (module, findingRef) identifier and a summary. Your job:
- Merge findings that describe the same underlying problem, across modules where relevant, into ONE recommendation, citing every finding it's based on.
- Write each recommendation as a concrete next step ("Fix X by doing Y"), never a restated finding ("X is broken").
- Rank recommendations by how influential fixing them would be, most influential first. This is an ORDER, not a score, so never state a numeric priority value.
- Every recommendation MUST cite at least one real (module, findingRef) pair from the list you were given. Never cite one that wasn't given to you.
- Never state a number, percentage, or count in a recommendation's title or description unless that exact number already appears in a finding you cite for it.
- Propose between 3 and 15 recommendations total.

- Never use em dashes or en dashes; use commas, colons or full stops instead.
Respond with ONLY JSON: {"recommendations": [{"title": string, "description": string, "sourceFindings": [{"module": string, "findingRef": string}, ...]}, ...]}. In your final priority order, most influential first.`;

@Injectable()
export class GapAnalysisGenerationService {
  constructor(private readonly llm: LlmService) {}

  async consolidate(findings: SourceFinding[]): Promise<RawRecommendation[]> {
    const listing = findings.map((f) => `- [${f.module} / ${f.findingRef}] ${f.summary}`).join('\n');
    const result = await this.llm.json<RawRecommendation[]>(
      {
        system: SYSTEM,
        user: `Findings:\n${listing}`,
        maxTokens: CONSOLIDATE_MAX_TOKENS,
        purpose: 'gap-analysis-consolidate',
      },
      (raw) => validate(raw),
    );
    return result.data;
  }
}

const VALID_MODULES: readonly SourceModule[] = ['technical-audit', 'social-activity', 'aeo-audit'];

function validate(raw: unknown): RawRecommendation[] {
  const arr = (raw as { recommendations?: unknown }).recommendations;
  if (!Array.isArray(arr)) throw new Error('recommendations missing or not an array');
  return arr
    .map((r): RawRecommendation | null => {
      if (!r || typeof r !== 'object') return null;
      const o = r as Record<string, unknown>;
      const title = typeof o.title === 'string' ? o.title.trim() : '';
      const description = typeof o.description === 'string' ? o.description.trim() : '';
      const sourceFindings = asSourceFindingRefs(o.sourceFindings);
      if (!title || !description || sourceFindings.length === 0) return null;
      return { title, description, sourceFindings };
    })
    .filter((r): r is RawRecommendation => r !== null);
}

function asSourceFindingRefs(value: unknown): Array<{ module: SourceModule; findingRef: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ module: SourceModule; findingRef: string }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    const module = VALID_MODULES.includes(o.module as SourceModule) ? (o.module as SourceModule) : null;
    const findingRef = typeof o.findingRef === 'string' ? o.findingRef : null;
    if (module && findingRef) out.push({ module, findingRef });
  }
  return out;
}
