/**
 * Deterministic guardrails over the raw LLM consolidation output. No I/O —
 * pure functions, testable against synthetic proposals without a live
 * LLM. This is what actually prevents "inventing things", per the
 * analysis doc: every citation must resolve to real collected data, every
 * number in a recommendation must already appear in what it cites.
 *
 * @module gap-analysis/services/gap-analysis.guardrails
 */

import { MAX_RECOMMENDATIONS, MIN_RECOMMENDATIONS } from '../gap-analysis.constants.js';
import type { GuardrailNote, RawRecommendation, SourceFinding, ValidatedRecommendation } from '../gap-analysis.types.js';

function findingKey(module: string, findingRef: string): string {
  return `${module}::${findingRef}`;
}

/** True when every citation on a recommendation resolves to a real collected finding. */
export function isFullyGrounded(rec: RawRecommendation, collected: SourceFinding[]): boolean {
  if (rec.sourceFindings.length === 0) return false;
  const known = new Set(collected.map((f) => findingKey(f.module, f.findingRef)));
  return rec.sourceFindings.every((c) => known.has(findingKey(c.module, c.findingRef)));
}

/** Numeric/percentage tokens worth checking — bare single digits are too common (list counts, "3 checks") to be a meaningful fabricated-score signal. */
const NUMBER_TOKEN_RE = /\d+(\.\d+)?%|\d{2,}(\.\d+)?/g;

/** True when every number/percentage the recommendation states already appears in the text of what it cites — nothing computed from scratch. */
export function hasNoFabricatedNumbers(rec: RawRecommendation, collected: SourceFinding[]): boolean {
  const groundingText = rec.sourceFindings
    .map((c) => collected.find((f) => f.module === c.module && f.findingRef === c.findingRef)?.summary ?? '')
    .join(' ');
  const claimed = `${rec.title} ${rec.description}`.match(NUMBER_TOKEN_RE) ?? [];
  return claimed.every((token) => groundingText.includes(token));
}

/**
 * Drops any recommendation that fails grounding or fabricates a number —
 * per-item rejection, same as Query Set's rationale-grounding check.
 * Ranking is reassigned after drops so surviving items are always
 * contiguous 1..N, never leaving a gap where a rejected item was.
 */
export function rejectUngroundedRecommendations(
  recommendations: RawRecommendation[],
  collected: SourceFinding[],
): { kept: RawRecommendation[]; notes: GuardrailNote[] } {
  const notes: GuardrailNote[] = [];
  const kept = recommendations.filter((rec) => {
    if (!isFullyGrounded(rec, collected)) {
      notes.push({ type: 'ungrounded-citation', title: rec.title, detail: `"${rec.title}" cites a finding reference not present in the collected source data.` });
      return false;
    }
    if (!hasNoFabricatedNumbers(rec, collected)) {
      notes.push({ type: 'fabricated-number', title: rec.title, detail: `"${rec.title}" states a number not present in any finding it cites.` });
      return false;
    }
    return true;
  });
  return { kept, notes };
}

/** Checks (does not fix) the surviving count is within [MIN_RECOMMENDATIONS, MAX_RECOMMENDATIONS]. */
export function checkRecommendationCount(recommendations: RawRecommendation[]): GuardrailNote[] {
  if (recommendations.length < MIN_RECOMMENDATIONS) {
    return [{ type: 'item-count-low', detail: `Only ${recommendations.length} recommendations survived grounding; minimum is ${MIN_RECOMMENDATIONS}.` }];
  }
  if (recommendations.length > MAX_RECOMMENDATIONS) {
    return [{ type: 'item-count-high', detail: `${recommendations.length} recommendations proposed; maximum is ${MAX_RECOMMENDATIONS}.` }];
  }
  return [];
}

/** Assigns final 1-based ordinal ranks in the LLM's own priority order — never a fabricated numeric score. */
export function assignRanks(recommendations: RawRecommendation[]): ValidatedRecommendation[] {
  return recommendations.slice(0, MAX_RECOMMENDATIONS).map((rec, i) => ({ ...rec, priorityRank: i + 1 }));
}
