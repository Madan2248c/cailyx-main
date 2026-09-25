/**
 * Stage 9: Consolidate (spec §18).
 *
 * One bounded LLM call per *run* covering every category that has validated
 * facts — not one call per category, and not one call per category
 * unconditionally: a category with zero facts costs nothing and gets a
 * deterministic summary that reports its expected fields as missing.
 *
 * Ported from the old repo's `aeo-context.service.ts` `stageConsolidate`
 * (lines 1442–1586) with two adaptations, both forced by our schema:
 *
 * - Results land in `ctx.state.summaries` (`CategorySummary[]`) instead of
 *   `siteContextCategorySummary` rows.
 * - The old `run.refine` gate ("this run must never call an LLM") has no
 *   analogue: our `discovery_runs` has no such column, and the design doc
 *   treats the LLM as the pipeline's core function rather than an opt-in
 *   (docs/analysis/discovery.md, "LLM client"). `llm.isAvailable()` is
 *   therefore the only gate left, and it produces the same deterministic
 *   fallback the old code used when it was false.
 *
 * @module discovery/services/stages/consolidate
 */

import { Injectable, Logger } from '@nestjs/common';
import { CANONICAL_VALUE_FIELDS, CATEGORY_FIELDS, VALUE_JUDGEMENT_CAP } from '../../discovery.constants.js';
import type { CategorySummary, FactField, ReconciledFact } from '../../discovery.types.js';
import type { DiscoveryRunContext } from '../pipeline-context.js';
import { LlmService } from '../../../llm/llm.service.js';

/** What the consolidation model is allowed to return, per category. */
interface ConsolidationEntry {
  category: string;
  summary: string | null;
  conflicts: string[];
  missingFields: string[];
  confidence: number;
}

/** One judgment on one value: keep it as a real value of its field, or drop it. */
interface ValueVerdict {
  category: string;
  value: string;
  keep: boolean;
  /** Set when this value is the same claim as another one that was kept. */
  duplicateOf: string | null;
}

/**
 * Words ignored when comparing two values for exact-duplicate purposes, so
 * "simpler APIs, better webhooks, and best-in-class debugging" and the same
 * phrase without "and" collapse. Only words that carry no value-identifying
 * meaning: "Sales and marketing" never collapses onto "Sales", because
 * "marketing" is not on this list.
 */
const FILLER_WORDS = new Set(['a', 'an', 'and', 'the', 'of', 'for', 'to', 'with']);

/**
 * Field → the kind of thing it should contain, phrased for the value judge.
 * Only fields where a list-level clean-up is safe are judged at all — see
 * `CANONICAL_VALUE_FIELDS`.
 */
const FIELD_KINDS: Record<string, string> = {
  services: 'a product or service a buyer could purchase',
  valueProps: "a claim about what the product does for the buyer, in the company's own words",
  differentiator: 'a reason to choose this company over alternatives, stated by the company itself',
  painPoints: 'a problem the buyer has before working with this company',
  outcomes: 'a result the company promises the buyer',
  technology: 'a technology, standard or integration the company actually uses or supports',
  certification: 'a certification, standard or compliance regime the company holds',
  partner: 'a named partner or integration relationship',
  award: 'a named award or recognition',
  icp: 'who buys — a role, company type or segment',
  markets: 'a geographic market the company serves',
  contact: 'a contact detail',
  languages: 'a language the company operates in',
  leadership: "a named person who is this company's own founder, executive or team member",
};

@Injectable()
export class ConsolidateStage {
  private readonly logger = new Logger(ConsolidateStage.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Full pass over every category in `CATEGORY_FIELDS`, skipped when the run
   * has already consolidated (a re-enqueued job picks up the previous job's
   * summaries rather than paying for the same call twice).
   */
  async run(ctx: DiscoveryRunContext): Promise<void> {
    if ((ctx.state.summaries ?? []).length > 0) return; // already consolidated on a prior attempt
    ctx.state.summaries = await this.summarize(ctx, Object.keys(CATEGORY_FIELDS));
  }

  /**
   * Re-summarise only the given categories, leaving the rest of
   * `ctx.state.summaries` untouched.
   *
   * This is what gap research calls after it fills some of consolidation's own
   * reported gaps: the summaries for the affected categories were built without
   * the newly found facts, so they are stale, while every other category is
   * still correct. The old code deleted all summaries and re-ran the full pass;
   * restricting the second pass to the categories that actually changed
   * produces the same summaries for less spend — the spec's ordering (§18
   * consolidation → §19 gap research → §20 *final* synthesis) still holds.
   */
  async runForCategories(ctx: DiscoveryRunContext, categories: string[]): Promise<void> {
    const wanted = categories.filter((c) => c in CATEGORY_FIELDS);
    if (wanted.length === 0) return;

    const refreshed = await this.summarize(ctx, wanted);
    const byCategory = new Map(refreshed.map((s) => [s.category, s]));
    const existing = ctx.state.summaries ?? [];
    // Replace in place so a consumer iterating the list keeps the canonical
    // category order, and any category we were not asked about survives as-is.
    const merged = existing.map((s) => byCategory.get(s.category) ?? s);
    for (const s of refreshed) {
      if (!merged.some((m) => m.category === s.category)) merged.push(s);
    }
    ctx.state.summaries = merged;
  }

  /**
   * The actual summarisation. Returns one `CategorySummary` per requested
   * category — always, so a caller can rely on the list being complete even
   * when the model was unavailable, returned nothing for a category, or threw.
   */
  private async summarize(ctx: DiscoveryRunContext, categories: string[]): Promise<CategorySummary[]> {
    const validFacts = (ctx.state.facts ?? []).filter((f) => f.validated);
    const byCategory = new Map<string, ReconciledFact[]>();
    for (const category of categories) {
      const fields = CATEGORY_FIELDS[category];
      byCategory.set(
        category,
        validFacts.filter((f) => fields.includes(f.field)),
      );
    }

    const nonEmpty = [...byCategory.entries()].filter(([, facts]) => facts.length > 0);

    // Nothing to consolidate, or no model to consolidate with: fall back to the
    // deterministic per-category summaries.
    //
    // A category that has facts reports nothing missing here, even though no
    // prose was written for it — the fields are not absent, only unsummarised.
    // That also keeps this path consistent with the two failure paths below:
    // `missingFields` is the pipeline's completeness signal, so an LLM-less run
    // that extracted successfully must not score every category as empty. (The
    // old code's degenerate path reported all fields missing for every
    // category, which conflated "could not summarise" with "found nothing" —
    // see docs/analysis/discovery.md "As built".)
    if (nonEmpty.length === 0 || !this.llm.isAvailable()) {
      return categories.map((category) => this.emptySummary(category, (byCategory.get(category) ?? []).map((f) => f.value)));
    }

    const payload = nonEmpty.map(([category, facts]) => ({
      category,
      facts: facts.map((f) => ({ field: f.field, value: f.value, factType: f.factType, confidence: f.confidence })),
    }));

    // Which values are real values of their field — run alongside the summary
    // call, because it is a different question that the same prompt could not
    // answer (see `judgeValues`). Failure is fail-open: no canonical list means
    // `compile` filters nothing.
    const canonical = await this.judgeValues(ctx, byCategory).catch(() => new Map<string, string[]>());

    try {
      const result = await this.llm.json(
        {
          purpose: 'category-level consolidation',
          maxTokens: 2200,
          system:
            'You consolidate already-extracted, already-cited facts about one company into a short per-category ' +
            'summary. You do not have the source pages — only the facts below. Rules:\n' +
            '- Never invent a fact not present in the input.\n' +
            '- A conflict is two facts in the same category that cannot both be true (not just two different ' +
            'offerings). List conflicts explicitly; do not silently pick one.\n' +
            "- missingFields: which of the category's expected fields (given per category below) have zero facts " +
            'after your clean-up.\n' +
            '- confidence: your assessment of how complete and mutually consistent this category is (0-1), based on ' +
            "the input facts' own confidence and factType — not a guess independent of them.\n" +
            '- Do not restate the input values: a separate pass decides which of them survive. Your job is the ' +
            'summary, the conflicts and which expected fields are still empty.\n' +
            'Respond with ONLY JSON: {"categories":[{"category":string,"summary":string,"facts":string[],' +
            '"conflicts":string[],"missingFields":string[],"confidence":number}]}',
          user:
            'Categories and their expected fields:\n' +
            Object.entries(CATEGORY_FIELDS)
              .map(([c, f]) => `${c}: ${f.join(', ')}`)
              .join('\n') +
            '\n\nExtracted facts by category:\n' +
            JSON.stringify(payload),
        },
        (raw) => this.validateConsolidation(raw),
      );

      const summarised = new Map<string, CategorySummary>();
      for (const c of result.data) {
        summarised.set(c.category, {
          category: c.category,
          // The judged list when we have one; otherwise every extracted value,
          // de-duplicated only by exact-normalized match. Never empty unless the
          // category genuinely has no values: an empty list means "filter
          // nothing" to compile, so an accidental empty one would hide the
          // clean-up rather than break the profile.
          facts: canonical.get(c.category) ?? this.collapseExactDuplicates((byCategory.get(c.category) ?? []).map((f) => f.value)),
          summary: c.summary ?? '',
          // The summary call never saw the value verdicts, so when the judged
          // list is empty the model's "everything is present" cannot stand.
          missingFields: canonical.get(c.category)?.length === 0 ? [...CATEGORY_FIELDS[c.category]!] : (c.missingFields as FactField[]),
          conflictNotes: c.conflicts,
        });
      }

      // A category the model skipped is not "complete" — it falls back to the
      // deterministic rule: no facts means every field is missing, some facts
      // means nothing is missing (we simply have no summary text for it).
      return categories.map((category) => {
        const fromModel = summarised.get(category);
        if (fromModel) return fromModel;
        return this.emptySummary(category, (byCategory.get(category) ?? []).map((f) => f.value), canonical.get(category));
      });
    } catch (err) {
      this.logger.warn(
        `Category consolidation failed for run ${ctx.runId}: ${(err as Error).message} — falling back to deterministic per-category summaries.`,
      );
      return categories.map((category) => this.emptySummary(category, (byCategory.get(category) ?? []).map((f) => f.value)));
    }
  }

  /**
   * Deterministic fallback for one category.
   *
   * @param hasFacts When true the category had facts but no summary could be
   *   produced, so nothing is reported missing (the facts exist; only the
   *   prose is absent). When false nothing was found at all, so every expected
   *   field is missing — which is exactly what drives the completeness score.
   */
  private emptySummary(category: string, values: string[], judged?: string[]): CategorySummary {
    const facts = judged ?? this.collapseExactDuplicates(values);
    return {
      category,
      summary: '',
      // The judged list when the value pass ran; otherwise the values deduped
      // but otherwise untouched, because with no model there is nothing that
      // could clean them and pretending otherwise would hide the real list.
      facts,
      // "Is the field absent?" — answered from what survived, so a category
      // whose every value was judged away reads as empty rather than present.
      missingFields: facts.length > 0 ? [] : [...CATEGORY_FIELDS[category]],
      conflictNotes: [],
    };
  }

  /**
   * Trust boundary for the summary call: an unknown category, an unknown field
   * name or a non-string is dropped, never coerced. The value list is not part
   * of this call — see {@link judgeValues}.
   */
  private validateConsolidation(raw: unknown): ConsolidationEntry[] {
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
    const out: ConsolidationEntry[] = [];
    for (const entry of obj.categories) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const category = typeof e.category === 'string' ? e.category : '';
      if (!validCategories.has(category)) continue;
      const confidenceRaw = typeof e.confidence === 'number' ? e.confidence : 0;
      out.push({
        category,
        summary: typeof e.summary === 'string' ? e.summary.trim().slice(0, 500) : null,
        conflicts: strArr(e.conflicts),
        missingFields: strArr(e.missingFields).filter((f) => (CATEGORY_FIELDS[category] as string[]).includes(f)),
        confidence: Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0,
      });
    }
    return out;
  }

  /**
   * Collapse values that are the same string once case, punctuation and spacing
   * are ignored ("simpler APIs, better webhooks, and best-in-class debugging" /
   * "simpler APIs, better webhooks, best-in-class debugging").
   *
   * Deterministic and deliberately shallow. Merging things that merely *mean*
   * the same is the model's job below, because deciding that "emails landing in
   * spam" and "emails landing in spam folder instead of inbox" are one claim is
   * a judgement, and a substring rule that guessed wrong would drop the more
   * specific of the two.
   */
  private collapseExactDuplicates(values: string[]): string[] {
    const seen = new Map<string, string>();
    for (const value of values) {
      const key = value
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, ' ')
        .split(/\s+/)
        .filter((word) => word && !FILLER_WORDS.has(word))
        .join(' ');
      if (!seen.has(key)) seen.set(key, value);
    }
    return [...seen.values()];
  }

  /**
   * Decide, value by value, which extracted values are real values of their
   * field — and which are marketing copy that merely sat in a heading.
   *
   * This is a **separate call from the summary**, on purpose. Asked to *edit* a
   * list ("return the cleaned values"), the small model this pipeline runs on
   * returned every value unchanged, slogans included. Asked to judge one value
   * at a time, it dropped 14 of the 28 values from a real page — every call to
   * action, benefit claim, slogan and section heading — while keeping the named
   * capabilities. Classification it can do; editing it cannot.
   *
   * Fail-open: a value the model did not rule on is **kept**. A truncated or
   * partial response must never silently empty a field, and the alternative
   * (treating "no verdict" as "drop") would let one bad response cost the
   * profile its offerings. The trust boundary that matters still holds —
   * verdicts come back as values, and only values that were already in the
   * input can survive into the canonical list.
   */
  private async judgeValues(
    ctx: DiscoveryRunContext,
    byCategory: Map<string, ReconciledFact[]>,
  ): Promise<Map<string, string[]>> {
    const judgeable = new Map<string, string[]>(); // category → values
    for (const [category, facts] of byCategory) {
      const values: string[] = [];
      for (const fact of facts) {
        if (!CANONICAL_VALUE_FIELDS.has(fact.field) || !FIELD_KINDS[fact.field]) continue;
        if (!values.includes(fact.value)) values.push(fact.value);
      }
      if (values.length > 0) judgeable.set(category, values);
    }
    const canonical = new Map<string, string[]>();
    if (judgeable.size === 0) return canonical;

    // One call per category **chunk**, deliberately: a single prompt carrying
    // every category's values ran to hundreds of lines on a real site, and the
    // model answered nothing usable — the same failure as the list-editing
    // prompt, for the same reason. A short, single-subject list is what it can
    // judge — which is also why a category with more values than one call can
    // hold is judged in several calls rather than truncated. Truncating meant
    // every value past the cut silently skipped judgement and was kept by the
    // fail-open rule regardless of what it actually was — on a real site, over
    // half a long offerings list went unjudged this way.
    for (const [category, values] of judgeable) {
      const verdicts: ValueVerdict[] = [];
      for (let i = 0; i < values.length; i += VALUE_JUDGEMENT_CAP) {
        const chunk = values.slice(i, i + VALUE_JUDGEMENT_CAP);
        const chunkVerdicts = await this.judgeChunk(ctx, category, chunk);
        if (chunkVerdicts === null) continue; // this chunk's values are kept unchanged, per the fail-open rule
        verdicts.push(...chunkVerdicts);
      }

      // Verdicts are keyed back to the exact input spelling, and anything not
      // ruled on is kept (see the fail-open note above) — including a value
      // whose chunk failed to judge at all.
      const ruled = new Map(verdicts.map((v) => [v.value.toLowerCase(), v]));
      canonical.set(
        category,
        this.collapseExactDuplicates(
          values.filter((value) => {
            const verdict = ruled.get(value.toLowerCase());
            if (!verdict) return true;
            return verdict.keep && verdict.duplicateOf === null;
          }),
        ),
      );
    }
    return canonical;
  }

  /**
   * Judge one chunk (at most `VALUE_JUDGEMENT_CAP` values) of one category.
   *
   * @returns the chunk's verdicts, or `null` when the call itself failed — the
   *   caller keeps a `null` chunk's values unchanged rather than treating a
   *   transient failure as "everything in this chunk is fine to drop nothing
   *   about", which would be the wrong kind of fail-open (silence, not signal).
   */
  private async judgeChunk(
    ctx: DiscoveryRunContext,
    category: string,
    values: string[],
  ): Promise<ValueVerdict[] | null> {
    const kinds = (CATEGORY_FIELDS[category] ?? [])
      .filter((f) => FIELD_KINDS[f])
      .map((f) => `- ${f}: ${FIELD_KINDS[f]}`)
      .join('\n');
    try {
      const result = await this.llm.json(
        {
          purpose: 'offering value verdicts',
          maxTokens: 2000,
          system:
            'You judge values that were extracted from one company\'s website. You are not told anything about ' +
            'the company beyond the values themselves.\n' +
            'For EVERY value below, decide whether it is what its field says it is, and answer keep true or false.\n' +
            'keep is false when the value is not that thing at all — most often marketing copy that happened to ' +
            'sit in a heading or a call-out:\n' +
            '  * a call to action, including an imperative that tells the reader to do something ("Integrate ' +
            'tonight", "Start free", "Start sending tonight", "Book a demo", "Try it today")\n' +
            '  * a benefit, quality or outcome claim where the field asks for a thing ("First-class developer ' +
            'experience", "Battle-tested infrastructure", "Faster time to inbox")\n' +
            '  * a slogan, tagline or rallying line ("Reach humans, not spam folders", "Do more with your time", ' +
            '"Ready for every use case", "Everything you need in one place", "Build inboxes your way")\n' +
            '  * a page section heading or navigation label — including a page title from a nav menu, an FAQ ' +
            'heading, or a site-section name ("Everything in your control", "Full visibility", "Frequently asked ' +
            'questions", "Security & privacy", "Analyze and track performance")\n' +
            '  * a vague promise with no named thing in it ("Beyond expectations")\n' +
            '  * a price or plan line — for example "Domains - $20 / mo" or "Automations · $0.0015 / per run" — ' +
            'where the field asks for the thing itself: the offering is the thing, the price is a detail the ' +
            'site states elsewhere\n' +
            '  * a third party speaking (a customer testimonial, case-study quote or partner marketing) in a field ' +
            'that is about the company\'s own doing\n' +
            '  * for leadership, someone who is not this company\'s own person — an investor, advisor, customer, or ' +
            "another company's executive quoted on the page\n" +
            'Test for a thing-field: could a buyer point at this as something they purchased, or name it back to ' +
            'you as a feature of the product? If it only says how good the product is, or tells the reader to do ' +
            'something, or is a UI section name, keep is false.\n' +
            'If two values state the same claim in different words, keep the clearer one and set the other\'s ' +
            '"duplicateOf" to the kept value, copied verbatim.\n' +
            'When in doubt about a named, purchasable thing, keep it — omitting a real offering is worse than ' +
            'carrying a dull one.\n' +
            'Respond with ONLY JSON: {"verdicts":[{"value":string,"keep":boolean,"duplicateOf":string|null}]} — ' +
            'one entry per value below, "value" copied VERBATIM.',
          user:
            `Category: ${category}\nField definitions:\n${kinds}\n\nValues to judge:\n` +
            values.map((v) => `  ${v}`).join('\n'),
        },
        (raw) => this.validateVerdicts(raw, category, values),
      );
      return result.data;
    } catch (err) {
      this.logger.warn(
        `Value judgement failed for ${category} on run ${ctx.runId}: ${(err as Error).message} — keeping that chunk's values unchanged.`,
      );
      await ctx.note(`Value clean-up could not run for part of "${category}" — those extracted values are kept as-is this run.`);
      return null;
    }
  }

  /**
   * Keeps only verdicts about a value that was actually put to the model.
   *
   * The category is the caller's, not the model's: one call judges one
   * category, so there is nothing for the model to name — asking it to echo a
   * category back is one more field to get wrong, and it did: every verdict was
   * discarded for want of a `category` the prompt no longer requested.
   */
  private validateVerdicts(raw: unknown, category: string, values: string[]): ValueVerdict[] {
    const obj = (raw ?? {}) as { verdicts?: unknown };
    if (!Array.isArray(obj.verdicts)) return [];
    const known = new Map(values.map((v) => [v.toLowerCase(), v]));
    const out: ValueVerdict[] = [];
    for (const entry of obj.verdicts) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const value = typeof e.value === 'string' ? e.value.trim() : '';
      if (!value) continue;
      const canonical = known.get(value.toLowerCase());
      if (canonical === undefined) continue; // not one of the values we asked about
      const duplicateRaw = typeof e.duplicateOf === 'string' ? e.duplicateOf.trim() : null;
      out.push({
        category,
        value: canonical,
        keep: e.keep === true,
        duplicateOf: duplicateRaw && known.has(duplicateRaw.toLowerCase()) ? duplicateRaw : null,
      });
    }
    return out;
  }
}
