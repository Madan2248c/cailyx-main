/**
 * Verify stage — an independent second pass that re-reads consolidate's own
 * output against the evidence facts it was built from.
 *
 * Ported from the old repo's `aeo-context.service.ts` `stageVerify`
 * (lines 1901–2001), including its prompt text and validator. Two things are
 * deliberately *not* changed from there:
 *
 * 1. **It reads the synthesis, not the pages.** The validate stage already
 *    checked every fact's excerpt against its own citing page; re-checking that
 *    here would duplicate work and catch nothing new. What this stage catches
 *    is the class of error validation cannot: a claim that is technically
 *    verbatim but is really about a *customer, partner or competitor* named in
 *    passing, or one that blends a current fact with a historical one, or a
 *    first-party fact with a third-party one, as though they were one
 *    statement.
 * 2. **It may only remove or penalise, never add.** A verifier that can
 *    introduce claims is just a second extractor with no page to cite; every
 *    claim it keeps still traces back to a validated fact.
 *
 * It reads and writes `ctx.state` only — no database access — so it takes no
 * Prisma dependency (the old code read its summaries from a table; ours live in
 * the run's `pipeline_state`).
 *
 * @module verify.stage
 */

import { Injectable, Logger } from '@nestjs/common';
import { CATEGORY_FIELDS } from '../../discovery.constants.js';
import type { ReconciledFact } from '../../discovery.types.js';
import { LlmService } from '../../../llm/llm.service.js';
import type { DiscoveryRunContext } from '../pipeline-context.js';

/** One category as the verifier returns it. */
interface VerifiedCategory {
  category: string;
  claims: string[];
  summary: string | null;
  issues: string[];
  confidencePenalty: number;
}

@Injectable()
export class VerifyStage {
  private readonly logger = new Logger(VerifyStage.name);

  constructor(private readonly llm: LlmService) {}

  async run(ctx: DiscoveryRunContext): Promise<void> {
    const summaries = ctx.state.summaries ?? [];
    const facts = ctx.state.facts ?? [];
    if (summaries.length === 0 || facts.length === 0) return;

    // Only categories that actually produced claims are worth a call — the old
    // code's filter was `(JSON.parse(s.facts) as unknown[]).length > 0`, which
    // is the same test expressed against our state shape.
    const nonEmpty = summaries.filter((s) => this.claimsInCategory(facts, s.category).length > 0);
    if (nonEmpty.length === 0 || !this.llm.isAvailable()) return;

    const payload = nonEmpty.map((s) => ({
      category: s.category,
      claims: this.claimsInCategory(facts, s.category),
      summary: s.summary,
      evidence: this.factsInCategory(facts, s.category).map((f) => ({
        field: f.field,
        value: f.value,
        excerpt: f.sources.find((src) => src.excerpt)?.excerpt ?? null,
        factType: f.factType,
      })),
    }));

    try {
      const result = await this.llm.json(
        {
          purpose: 'independent claim verification',
          maxTokens: 2000,
          system:
            'You are an independent verifier reviewing another pass\'s output, not the original extractor — read ' +
            'skeptically. For each category, you get its synthesized `claims`/`summary` and the raw `evidence` facts ' +
            '(with excerpts) they were supposedly built from. Check every claim against the evidence and flag:\n' +
            '- A claim with no evidence fact that actually supports it (fabricated or over-generalized during synthesis).\n' +
            '- A claim that is really about a customer, partner, or competitor named in the evidence, not the subject company.\n' +
            '- A claim that blends a current fact with a historical one, or a first-party claim with a third-party one, ' +
            'as if they were the same statement.\n' +
            'Never add a new claim. Return only claims/summaries you keep — omit ones you drop. confidencePenalty is 0 ' +
            'when nothing is wrong, up to 1 when the summary is mostly unsupported.\n' +
            'Respond with ONLY JSON: {"categories":[{"category":string,"claims":string[],"summary":string|null,' +
            '"issues":string[],"confidencePenalty":number}]}',
          user: 'Categories to verify:\n' + JSON.stringify(payload),
        },
        (raw) => this.validateVerification(raw),
      );

      this.applyVerification(ctx, result.data);
      await ctx.note(`__cost__:${result.costUsd}:${result.model}`);
    } catch (err) {
      // Verification is a safety net, not a gate: if it cannot run, the
      // summaries stay exactly as consolidate produced them, unverified —
      // which is the honest state, and better than losing a whole run's
      // synthesis over a failed second opinion.
      this.logger.warn(
        `Independent verification failed for run ${ctx.runId}: ${(err as Error).message} — category summaries kept as consolidated, unverified.`,
      );
    }
  }

  /**
   * Apply the verifier's verdict: drop the claims it omitted, lower the
   * confidence of the ones it kept, and record its issues as conflicts.
   *
   * A dropped claim is marked unvalidated rather than deleted, so compile's
   * `validated` filter excludes it while the run still records what was removed
   * and why. A penalty is applied to every fact in the affected category rather
   * than to the summary alone, because in our schema the per-category
   * confidence the old code kept on its summary row now lives on the facts
   * themselves — the summary is prose, and a number stored beside it would have
   * nowhere to go in `profile_json`.
   */
  private applyVerification(ctx: DiscoveryRunContext, verified: VerifiedCategory[]): void {
    const facts = ctx.state.facts ?? [];
    const summaries = ctx.state.summaries ?? [];

    for (const c of verified) {
      const original = summaries.find((s) => s.category === c.category);
      if (!original) continue;

      const kept = new Set(c.claims.map((claim) => claim.trim().toLowerCase()));
      const inCategory = this.factsInCategory(facts, c.category);
      let dropped = 0;

      for (const fact of inCategory) {
        if (!kept.has(fact.value.trim().toLowerCase())) {
          fact.validated = false;
          fact.validationNote = 'Removed by independent verification: not supported by the evidence it was synthesized from.';
          fact.confidence = 0;
          dropped++;
          continue;
        }
        if (c.confidencePenalty > 0) {
          fact.confidence = Math.max(0, Number((fact.confidence - c.confidencePenalty).toFixed(3)));
        }
      }

      original.summary = c.summary ?? original.summary;
      original.conflictNotes = [...original.conflictNotes, ...c.issues.map((issue) => `Verification: ${issue}`)];

      if (dropped > 0 || c.issues.length > 0) {
        this.logger.debug(
          `Verification on "${c.category}": ${dropped} claim(s) dropped, ${c.issues.length} issue(s) noted.`,
        );
      }
    }
  }

  /** Facts belonging to a category — by consolidate's assignment, else by field membership. */
  private factsInCategory(facts: ReconciledFact[], category: string): ReconciledFact[] {
    const fields = CATEGORY_FIELDS[category] ?? [];
    return facts.filter((f) => (f.category ? f.category === category : fields.includes(f.field)));
  }

  private claimsInCategory(facts: ReconciledFact[], category: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const f of this.factsInCategory(facts, category)) {
      const key = f.value.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(f.value.trim());
    }
    return out;
  }

  /**
   * Validator, ported verbatim from the old code's `validateVerification`:
   * keep only known categories, coerce every field into the expected shape and
   * clamp the penalty to [0,1]. A model that returns something else loses that
   * entry rather than being trusted.
   */
  private validateVerification(raw: unknown): VerifiedCategory[] {
    const obj = (raw ?? {}) as { categories?: unknown };
    if (!Array.isArray(obj.categories)) return [];
    const validCategories = new Set(Object.keys(CATEGORY_FIELDS));
    const strArr = (v: unknown): string[] =>
      Array.isArray(v)
        ? v
            .filter((x): x is string => typeof x === 'string')
            .map((s) => s.trim().slice(0, 300))
            .filter(Boolean)
            .slice(0, 30)
        : [];
    const out: VerifiedCategory[] = [];
    for (const entry of obj.categories) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const category = typeof e.category === 'string' ? e.category : '';
      if (!validCategories.has(category)) continue;
      const penaltyRaw = typeof e.confidencePenalty === 'number' ? e.confidencePenalty : 0;
      out.push({
        category,
        claims: strArr(e.claims),
        summary: typeof e.summary === 'string' ? e.summary.trim().slice(0, 500) : null,
        issues: strArr(e.issues),
        confidencePenalty: Number.isFinite(penaltyRaw) ? Math.max(0, Math.min(1, penaltyRaw)) : 0,
      });
    }
    return out;
  }
}
