/**
 * Narrative service — a short standing commentary an operator reads before a
 * client call, generated from one run's deltas and findings against the
 * previous run.
 *
 * Rewritten from the old repo's `checks/audit-narrative.service.ts`: that
 * file hand-rolled its own OpenRouter `fetch()` call, duplicating plumbing
 * (headers, model default, cost extraction, timeout) the codebase already
 * has in `LlmService`. This version calls through that shared client instead
 * — the prompt's shape and rules are what's ported, not the HTTP layer.
 *
 * Runs after the audit is already persisted and never influences the score:
 * `write()` never throws, so its failure leaves every number in the run
 * intact and `narrative` simply stays unset.
 *
 * @module technical-audit/services/narrative
 */

import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../llm/llm.service.js';
import type { AuditDelta } from '../technical-audit.types.js';

export interface NarrativeInput {
  run: { at: string; score: number | null };
  previousRun: { at: string; score: number | null } | null;
  deltas: AuditDelta[];
  findings: Array<{ type: string; status: string; severity: string; recommendedFix: string }>;
  /** The prior run's own generated commentary, fed back as unverified prose — see `write()`. */
  previousNarrative: string | null;
}

export interface NarrativeResult {
  text: string;
  model: string;
  costUsd: number;
}

const MAX_TOKENS = 700;
const RECOMMENDED_FIX_LIMIT = 400;

const SYSTEM_PROMPT = `You are the analyst writing the short standing commentary an operator reads before a client call about their site's technical/SEO audit.

Write exactly four Markdown sections, in this order, and nothing before the first heading:
## Verdict
## What changed
## What matters now
## Watch next run

Rules:
- Be quantitative. Cite the real numbers you were given. Never invent a number that isn't in the input.
- Total output under 350 words.
- No preamble, no restating these instructions, no sign-off.
- If a previous narrative is included below, it is that PRIOR run's own generated commentary. Unverified prose, not fact. Re-check every claim in it against the current data. If the current data contradicts something it said, correct it explicitly rather than silently repeating it.

- Never use em dashes or en dashes; use commas, colons or full stops instead.
Respond with ONLY JSON: {"narrative": string}. The four-section Markdown above, as the value of that one field.`;

interface NarrativeResponse {
  narrative?: unknown;
}

@Injectable()
export class NarrativeService {
  private readonly logger = new Logger(NarrativeService.name);

  constructor(private readonly llm: LlmService) {}

  async write(input: NarrativeInput): Promise<NarrativeResult | null> {
    if (!this.llm.isAvailable()) return null;

    try {
      const whatMoved = input.deltas.filter((d) => d.direction === 'improved' || d.direction === 'regressed');
      const unchangedOrNew = input.deltas.filter((d) => d.direction === 'unchanged' || d.direction === 'new');

      const user = this.buildUser(input, whatMoved, unchangedOrNew);
      const result = await this.llm.json<string>(
        { system: SYSTEM_PROMPT, user, maxTokens: MAX_TOKENS, purpose: 'technical-audit narrative' },
        (raw) => this.validate(raw),
      );

      return { text: result.data, model: result.model, costUsd: result.costUsd };
    } catch (err) {
      this.logger.warn(`Narrative generation failed: ${(err as Error).message}`);
      return null;
    }
  }

  private buildUser(input: NarrativeInput, whatMoved: AuditDelta[], unchangedOrNew: AuditDelta[]): string {
    const parts: string[] = [];
    parts.push(`Current run: ${input.run.at}, score ${input.run.score ?? 'n/a'}.`);
    parts.push(
      input.previousRun
        ? `Previous run: ${input.previousRun.at}, score ${input.previousRun.score ?? 'n/a'}.`
        : 'Previous run: none. This is the first audit for this project.',
    );

    parts.push('\nWhat moved:');
    parts.push(
      whatMoved.length > 0
        ? JSON.stringify(whatMoved.map((d) => ({ label: d.label, from: d.previous, to: d.current, change: d.change, direction: d.direction })))
        : '(nothing moved)',
    );

    parts.push('\nUnchanged or new metrics:');
    parts.push(
      unchangedOrNew.length > 0
        ? JSON.stringify(unchangedOrNew.map((d) => ({ label: d.label, current: d.current, direction: d.direction })))
        : '(none)',
    );

    parts.push('\nChecks:');
    parts.push(
      JSON.stringify(
        input.findings.map((f) => ({
          check: f.type,
          status: f.status,
          severity: f.severity,
          guidance: f.recommendedFix.slice(0, RECOMMENDED_FIX_LIMIT),
        })),
      ),
    );

    if (input.previousNarrative) {
      parts.push('\nPrevious run\'s narrative (unverified. Re-check against the current data above):');
      parts.push(input.previousNarrative);
    }

    return parts.join('\n');
  }

  private validate(raw: unknown): string {
    const obj = raw as NarrativeResponse | null;
    const text = typeof obj?.narrative === 'string' ? obj.narrative.trim() : '';
    if (!text) throw new Error('empty narrative in model response');
    return text;
  }
}
