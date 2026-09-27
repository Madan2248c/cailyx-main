/**
 * Stance judging — a separate LLM call per Observation, reading its raw
 * answer text to classify HOW the subject was positioned (not just
 * whether it appeared, which Measurement's deterministic mentioned/cited
 * already computes). Ported from the old repo's `aeo-stance.service.ts`.
 *
 * Guardrails on the raw model output, applied here rather than trusted
 * from the model: a named rival only counts as `recommendedOver`/`losesTo`
 * when it matches a known `Competitor` row for the project — an unknown
 * name goes to `otherNamesSeen` instead (queued as a `candidate` row, never
 * silently promoted into a rivalry). Known non-competitor platforms
 * (ChatGPT, Google, review sites, social platforms) and the subject's own
 * brand are filtered out of every list.
 *
 * @module aeo-audit/services/aeo-stance.service
 */

import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../llm/llm.service.js';
import { STANCES, type Stance, type StanceJudgment } from '../aeo-audit.types.js';
import { STANCE_ANSWER_CHAR_CAP, STANCE_EVIDENCE_QUOTE_CAP, STANCE_MAX_TOKENS } from '../aeo-audit.constants.js';

/**
 * Platforms/services an LLM commonly names in an AI-visibility answer that
 * are never a rival business — filtered out of every name list regardless
 * of the project's own competitor data.
 */
const NON_COMPETITOR_PLATFORMS = new Set(
  [
    'chatgpt',
    'openai',
    'google',
    'perplexity',
    'gemini',
    'bing',
    'linkedin',
    'reddit',
    'g2',
    'capterra',
    'trustpilot',
    'youtube',
    'twitter',
    'x',
    'facebook',
    'instagram',
    'wikipedia',
  ].map((s) => s.toLowerCase()),
);

const SYSTEM = `You judge how an AI answer-engine's response positions one specific business ("the subject"), among the businesses/products it names.

Classify the subject's stance as exactly one of:
- recommended_primary: the subject is presented as THE top recommendation
- recommended_alternative: the subject is named as a valid option, not the top pick
- mentioned_neutral: the subject appears but isn't recommended or ranked
- mentioned_negative: the subject appears with negative framing
- absent: the subject is not named at all

Also extract, from the answer text only — never invent a name that isn't there:
- rankAmongBrands: the subject's 1-based position among every named brand, if the answer orders them; else null
- brandsNamed: every brand/company/product name the answer mentions, in the order they appear
- recommendedOver: brands the subject is explicitly placed ahead of
- losesTo: brands the subject is explicitly placed behind
- otherNamesSeen: same as brandsNamed (the caller does the filtering)
- evidenceQuote: the single verbatim sentence (max 280 chars) that most supports your stance call, or null if absent
- rationale: one sentence explaining your call

Respond with ONLY JSON: {"stance": string, "rankAmongBrands": number|null, "brandsNamed": string[], "recommendedOver": string[], "losesTo": string[], "otherNamesSeen": string[], "evidenceQuote": string|null, "rationale": string|null}`;

export interface StanceInput {
  observationId: string;
  rawAnswer: string;
  subjectName: string;
  /** Known competitor names for this project (tracked + candidate) — the only names `recommendedOver`/`losesTo` are allowed to cite. */
  knownCompetitorNames: string[];
}

export interface StanceOutput {
  observationId: string;
  stance: Stance;
  rankAmongBrands: number | null;
  brandsNamed: string[];
  recommendedOver: string[];
  losesTo: string[];
  /** Names seen that matched no known competitor, no non-competitor platform, and aren't the subject's own brand. */
  otherNamesSeen: string[];
  evidenceQuote: string | null;
  rationale: string | null;
  judgeModel: string;
  costUsd: number;
}

@Injectable()
export class AeoStanceService {
  private readonly logger = new Logger(AeoStanceService.name);

  constructor(private readonly llm: LlmService) {}

  async judge(input: StanceInput): Promise<StanceOutput> {
    const answer = input.rawAnswer.slice(0, STANCE_ANSWER_CHAR_CAP);
    const result = await this.llm.json<StanceJudgment>(
      {
        system: SYSTEM,
        user: `Subject business: ${input.subjectName}\n\nAnswer text:\n${answer}`,
        maxTokens: STANCE_MAX_TOKENS,
        purpose: 'aeo-stance-judge',
      },
      (raw) => validateJudgment(raw),
    );

    const known = new Set(input.knownCompetitorNames.map(normalizeName));
    const isNoise = (name: string) => {
      const n = normalizeName(name);
      return n === normalizeName(input.subjectName) || NON_COMPETITOR_PLATFORMS.has(n);
    };

    const recommendedOver = result.data.recommendedOver.filter((n) => known.has(normalizeName(n)));
    const losesTo = result.data.losesTo.filter((n) => known.has(normalizeName(n)));
    const otherNamesSeen = [...new Set(result.data.otherNamesSeen)].filter((n) => !isNoise(n) && !known.has(normalizeName(n)));

    return {
      observationId: input.observationId,
      stance: result.data.stance,
      rankAmongBrands: result.data.rankAmongBrands,
      brandsNamed: result.data.brandsNamed,
      recommendedOver,
      losesTo,
      otherNamesSeen,
      evidenceQuote: result.data.evidenceQuote?.slice(0, STANCE_EVIDENCE_QUOTE_CAP) ?? null,
      rationale: result.data.rationale,
      judgeModel: result.model,
      costUsd: result.costUsd,
    };
  }
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function validateJudgment(raw: unknown): StanceJudgment {
  const o = raw as Record<string, unknown>;
  const stance = STANCES.includes(o.stance as Stance) ? (o.stance as Stance) : null;
  if (!stance) throw new Error(`stance-judge returned an unrecognized stance: ${JSON.stringify(o.stance)}`);
  return {
    stance,
    rankAmongBrands: typeof o.rankAmongBrands === 'number' ? o.rankAmongBrands : null,
    brandsNamed: asStringArray(o.brandsNamed),
    recommendedOver: asStringArray(o.recommendedOver),
    losesTo: asStringArray(o.losesTo),
    otherNamesSeen: asStringArray(o.otherNamesSeen),
    evidenceQuote: typeof o.evidenceQuote === 'string' ? o.evidenceQuote : null,
    rationale: typeof o.rationale === 'string' ? o.rationale : null,
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}
