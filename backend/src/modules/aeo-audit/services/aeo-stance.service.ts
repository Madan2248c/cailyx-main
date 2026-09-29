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
import { cleanBrandName, isNoiseName, normalizeName } from './name-noise.js';

const SYSTEM = `You judge how an AI answer-engine's response positions one specific business ("the subject"), among the businesses/products it names. You are given a short brief about the subject (what it sells, to whom, where). Use it.

Classify the subject's stance as exactly one of:
- recommended_primary: the subject is presented as THE top recommendation
- recommended_alternative: the subject is named as a valid option, not the top pick
- mentioned_neutral: the subject appears but isn't recommended or ranked
- mentioned_negative: the subject appears with negative framing
- absent: the subject is not named at all

Then extract, from the answer text only. Never invent a name that isn't there:
- rankAmongBrands: the subject's 1-based position among every named brand, if the answer orders them; else null
- brandsNamed: every brand/company/product name the answer mentions, in the order they appear
- directCompetitors: the names in the answer that are DIRECT COMPETITORS of the subject. A direct competitor is a business a buyer could choose INSTEAD of the subject to meet the same need, in the same category, for the same kind of customer (use the brief to decide). These are NOT competitors, so never list them: brands or merchants the subject sells, lists or resells (they are its suppliers or partners); the products a shopper would spend a voucher or gift card on; payment networks, banks, wallets and gateways; phone or software platforms; review, news and social sites; generic terms. A business only counts if it plays the same role for the buyer as the subject. A single brand's own store, app, gift card or product is a merchant, not a competitor, even when the answer tells the buyer to buy from it (for example a restaurant, retailer, hotel, venue or airline). When unsure, leave the name out.
- recommendedOver: direct competitors the answer explicitly places behind the subject
- losesTo: direct competitors the buyer is pointed to INSTEAD of the subject. That means competitors the answer ranks above the subject, and also competitors the answer offers as the options for this need when the subject is absent or is not the top pick. Empty when the subject is the top recommendation, or when the answer names no direct competitor.
- otherNamesSeen: same as directCompetitors
- evidenceQuote: the single verbatim sentence (max 280 chars) that most supports your stance call, or null if absent
- rationale: one sentence explaining your call

If the brief does not state the target customer, infer it from what the subject sells. Respond with ONLY JSON: {"stance": string, "rankAmongBrands": number|null, "brandsNamed": string[], "directCompetitors": string[], "recommendedOver": string[], "losesTo": string[], "otherNamesSeen": string[], "evidenceQuote": string|null, "rationale": string|null}`;

export interface StanceInput {
  observationId: string;
  rawAnswer: string;
  subjectName: string;
  /** Known competitor names for this project (tracked + candidate), used to tell new rivals from ones already on file. */
  knownCompetitorNames: string[];
  /** Plain-text summary of what the subject sells, to whom and where (see business-brief.ts). */
  businessBrief?: string;
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
        user: `${input.businessBrief ? `Brief about the subject:\n${input.businessBrief}` : `Subject business: ${input.subjectName}`}\n\nAnswer text:\n${answer}`,
        maxTokens: STANCE_MAX_TOKENS,
        purpose: 'aeo-stance-judge',
      },
      (raw) => validateJudgment(raw),
    );

    const known = new Set(input.knownCompetitorNames.map(normalizeName));

    // New path: the model names the direct competitors, using the business brief. Only those can be
    // "lost to" / "recommended over", and only those are filed as new rival candidates. Never the
    // subject's own brand or a known non-competitor platform.
    // Legacy path (model gave no directCompetitors): only names already on file count.
    const clean = (names: string[]) => names.map(cleanBrandName).filter(Boolean);
    const direct = result.data.directCompetitors ? clean(result.data.directCompetitors) : undefined;
    const isRival = direct
      ? (() => {
          const set = new Set(direct.filter((n) => !isNoiseName(n, input.subjectName)).map(normalizeName));
          return (n: string) => set.has(normalizeName(n));
        })()
      : (n: string) => known.has(normalizeName(n));

    const recommendedOver = clean(result.data.recommendedOver).filter(isRival);
    const losesTo = [...new Set(clean(result.data.losesTo).filter(isRival))];
    const otherNamesSeen = [...new Set(clean(result.data.otherNamesSeen))].filter(
      (n) => !isNoiseName(n, input.subjectName) && !known.has(normalizeName(n)) && (direct ? isRival(n) : true),
    );

    return {
      observationId: input.observationId,
      stance: result.data.stance,
      rankAmongBrands: result.data.rankAmongBrands,
      brandsNamed: clean(result.data.brandsNamed),
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

function validateJudgment(raw: unknown): StanceJudgment {
  const o = raw as Record<string, unknown>;
  const stance = STANCES.includes(o.stance as Stance) ? (o.stance as Stance) : null;
  if (!stance) throw new Error(`stance-judge returned an unrecognized stance: ${JSON.stringify(o.stance)}`);
  return {
    stance,
    rankAmongBrands: typeof o.rankAmongBrands === 'number' ? o.rankAmongBrands : null,
    brandsNamed: asStringArray(o.brandsNamed),
    directCompetitors: Array.isArray(o.directCompetitors) ? asStringArray(o.directCompetitors) : undefined,
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
