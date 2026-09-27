/**
 * Narrative — reframes the deterministic headlines into customer-facing
 * prose. Never computes a new number; forbidden from inventing one.
 * Best-effort, fire-and-forget: called only after `buildVerdict()`, never
 * blocks audit completion. Ported from the old repo's
 * `aeo-narrative.service.ts`.
 *
 * @module aeo-audit/services/aeo-narrative.service
 */

import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../llm/llm.service.js';
import { NARRATIVE_HEADLINE_CHAR_CAP, NARRATIVE_MAX_HEADLINES, NARRATIVE_MAX_TOKENS } from '../aeo-audit.constants.js';

const SYSTEM = `You turn a set of already-computed audit headlines into customer-facing prose for an AI-visibility report.

Rules:
- Never invent a number, percentage, or count that isn't already in the headlines you're given.
- Rewrite for a business audience, not a technical one — same facts, clearer framing.
- If prior-period facts are given, you may frame a change ("up from X"), but only using the exact prior numbers given — never estimate a delta yourself.
- Return at most ${NARRATIVE_MAX_HEADLINES} lines, each at most ${NARRATIVE_HEADLINE_CHAR_CAP} characters.

Respond with ONLY JSON: {"headlines": string[]}`;

export interface NarrativeInput {
  headlines: string[];
  priorHeadlines?: string[];
}

export interface NarrativeResult {
  headlines: string[];
  model: string;
  costUsd: number;
}

@Injectable()
export class AeoNarrativeService {
  private readonly logger = new Logger(AeoNarrativeService.name);

  constructor(private readonly llm: LlmService) {}

  async write(input: NarrativeInput): Promise<NarrativeResult> {
    const user = input.priorHeadlines?.length
      ? `Current headlines:\n${input.headlines.join('\n')}\n\nPrior-period headlines (for comparison only, do not recompute):\n${input.priorHeadlines.join('\n')}`
      : `Current headlines:\n${input.headlines.join('\n')}`;

    const result = await this.llm.json<string[]>(
      { system: SYSTEM, user, maxTokens: NARRATIVE_MAX_TOKENS, purpose: 'aeo-narrative' },
      (raw) => validate(raw),
    );
    return { headlines: result.data, model: result.model, costUsd: result.costUsd };
  }
}

function validate(raw: unknown): string[] {
  const arr = (raw as { headlines?: unknown }).headlines;
  if (!Array.isArray(arr) || arr.length === 0) throw new Error('narrative returned no headlines');
  const lines = arr.filter((l): l is string => typeof l === 'string' && l.trim().length > 0).slice(0, NARRATIVE_MAX_HEADLINES);
  if (lines.length === 0) throw new Error('narrative headlines were all empty');
  return lines.map((l) => l.slice(0, NARRATIVE_HEADLINE_CHAR_CAP));
}
