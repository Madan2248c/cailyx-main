/**
 * Stage 5 — Reconcile.
 *
 * Merges the facts the extract stage left on the run's pages into one value per
 * field-claim, resolves singular-field conflicts, applies the tier/nav filter to
 * LLM-proposed services, and computes each fact's confidence (§13) from
 * factType + citing-page authority + cross-source agreement — never the model's
 * bare self-report.
 *
 * Ported from the old repo's `AeoContextService.stageReconcile` +
 * `computeConfidence`. The formula, the thresholds and the note wording are
 * verbatim; the merge is the part that had to be built, because the old code
 * kept one row per fact instance and this module keeps one entry per
 * field+value (see below).
 *
 * ## What "merging" means here, and why it is not a behaviour change
 *
 * The old code stored N rows for N sightings of the same value and never
 * deduped them; compile deduped by value at the end. Our persisted shape is
 * `ReconciledFact[]` — one entry per field+value with every source under it —
 * so the dedup that used to happen at compile time happens here instead. Three
 * rules carry the old semantics across:
 *
 * - **Corroboration counts sightings, not distinct URLs.** The old
 *   `crossSourceCount` incremented once per row, so the same value found twice
 *   on one page (a heading and an LLM fact) counted twice. `sources` dedupes by
 *   URL for evidence, but the confidence boost uses the member count, exactly
 *   as the old formula did.
 * - **Authority is the best available.** A value corroborated by a homepage and
 *   a blog post gets the homepage's authority boost — the old code gave each
 *   row its own page's boost and the surviving row kept it.
 * - **factType is the strongest member's** (`explicit` > `strong_inference` >
 *   `weak_inference`), unless any member was marked `conflicted`, which is
 *   sticky — a conflicted claim must not read as settled just because one more
 *   page agreed with one side.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service.js';
import {
  AUTHORITY_BOOST,
  AUTHORITY_BOOST_PAGE_TYPES,
  CORROBORATION_BOOST_MAX_SOURCES,
  CORROBORATION_BOOST_PER_SOURCE,
  FACT_TYPE_BASE,
  NAV_NOISE,
  SINGULAR_FIELDS,
  TIER_AND_STEP_WORDS,
} from '../../discovery.constants.js';
import type { DraftFact, FactField, FactSource, FactType, ReconciledFact } from '../../discovery.types.js';
import { PRISMA_TO_PAGE_TYPE, readPageState } from '../../discovery.types.js';
import type { DiscoveryRunContext } from '../pipeline-context.js';

/** Strongest → weakest. `conflicted` is handled separately: it is sticky. */
const FACT_TYPE_STRENGTH: FactType[] = ['explicit', 'strong_inference', 'weak_inference'];

@Injectable()
export class ReconcileStage {
  constructor(private readonly prisma: PrismaService) {}

  async run(ctx: DiscoveryRunContext): Promise<void> {
    const pages = await this.prisma.discoveredPage.findMany({
      where: { discoveryRunId: ctx.runId },
      orderBy: { url: 'asc' },
    });

    // The page's purpose category is the classifier's own verdict, and is what
    // the old authority check read.
    const purposeByUrl = new Map<string, string | null>();
    for (const page of pages) {
      purposeByUrl.set(page.url, readPageState(page.pipelineState).purposeCategory ?? null);
    }

    // Every fact the extract stage persisted, with the page it came from. The
    // fetch time comes off the page state so an evidence quote carries the time
    // of its own fetch, not the time this stage happened to run.
    const sightings: Array<{ fact: DraftFact; pageType: string | null; fetchedAt: string }> = [];
    for (const page of pages) {
      const state = readPageState(page.pipelineState);
      const fetchedAt = state.fetchedAt ?? page.createdAt.toISOString();
      for (const fact of state.facts ?? []) {
        sightings.push({ fact, pageType: purposeByUrl.get(fact.sourceUrl) ?? PRISMA_TO_PAGE_TYPE[page.pageType], fetchedAt });
      }
    }

    const merged = this.merge(sightings);

    // ─── Singular-field conflicts ───────────────────────────────────────────
    for (const field of SINGULAR_FIELDS) {
      const values = new Set(merged.filter((f) => f.field === field).map((f) => f.value.trim().toLowerCase()));
      if (values.size <= 1) continue;
      await ctx.note(
        `Unresolved conflict on "${field}": ${values.size} different values found across selected pages. The most-cited one wins, the rest are dropped.`,
      );
      for (const fact of merged.filter((f) => f.field === field)) {
        fact.factType = 'conflicted';
      }
    }

    // ─── Services that are really tier/step/nav words ───────────────────────
    for (const fact of merged) {
      if (fact.field !== 'services') continue;
      const words = fact.value.trim().split(/\s+/);
      if (NAV_NOISE.test(fact.value) || (words.length > 0 && words.every((w) => TIER_AND_STEP_WORDS.test(w)))) {
        fact.validated = false;
        fact.validationNote = 'Reconcile: reads as a pricing tier/process step/nav label, not an offering.';
      }
    }

    // ─── Confidence (§13) ───────────────────────────────────────────────────
    const corroboration = new Map<string, number>();
    for (const sighting of sightings) {
      const key = this.key(sighting.fact.field, sighting.fact.value);
      corroboration.set(key, (corroboration.get(key) ?? 0) + 1);
    }
    for (const fact of merged) {
      const authority = fact.sources.some((s) => s.pageType !== null && AUTHORITY_BOOST_PAGE_TYPES.has(s.pageType)) ? 2 : 1;
      fact.confidence = this.computeConfidence(
        fact.factType,
        authority,
        corroboration.get(this.key(fact.field, fact.value)) ?? 1,
      );
    }

    ctx.state.facts = merged;
  }

  /**
   * One entry per field+value, every source under it. Facts that came from
   * bounded search keep `sourceType: 'external'` — they are never the reason a
   * first-party value's confidence rises.
   */
  private merge(sightings: Array<{ fact: DraftFact; pageType: string | null; fetchedAt: string }>): ReconciledFact[] {
    const byKey = new Map<string, ReconciledFact>();
    const order: string[] = [];

    for (const { fact, pageType, fetchedAt } of sightings) {
      const key = this.key(fact.field, fact.value);
      const source: FactSource = {
        url: fact.sourceUrl,
        pageType: (pageType as FactSource['pageType']) ?? null,
        excerpt: fact.excerpt,
        fetchedAt,
        contentHash: fact.contentHash,
      };
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          field: fact.field,
          value: fact.value.trim(),
          factType: fact.factType ?? 'explicit',
          confidence: 0,
          sources: [source],
          sourceType: fact.sourceType ?? 'first_party',
          validated: false,
          validationNote: null,
        });
        order.push(key);
        continue;
      }
      existing.sources = this.addSource(existing.sources, source);
      existing.factType = this.stronger(existing.factType, fact.factType ?? 'explicit');
      if ((fact.sourceType ?? 'first_party') === 'external') existing.sourceType = 'external';
    }

    return order.map((key) => byKey.get(key)!);
  }

  private addSource(sources: FactSource[], source: FactSource): FactSource[] {
    const index = sources.findIndex((s) => s.url === source.url);
    if (index === -1) return [...sources, source];
    // Same page, another sighting: keep the first excerpt, but never lose a
    // content hash the first sighting lacked.
    const existing = sources[index]!;
    const merged: FactSource = {
      ...existing,
      excerpt: existing.excerpt ?? source.excerpt,
      contentHash: existing.contentHash ?? source.contentHash,
    };
    return sources.map((s, i) => (i === index ? merged : s));
  }

  private stronger(a: FactType, b: FactType): FactType {
    // `conflicted` is sticky in both directions: an unresolved disagreement is
    // not settled by either side gaining another sighting.
    if (a === 'conflicted' || b === 'conflicted') return 'conflicted';
    const rank = (t: FactType): number => {
      const i = FACT_TYPE_STRENGTH.indexOf(t);
      return i === -1 ? FACT_TYPE_STRENGTH.length : i;
    };
    return rank(a) <= rank(b) ? a : b;
  }

  /** §13's weighting — factType is the dominant signal; authority and corroboration only adjust within its band. */
  private computeConfidence(factType: FactType, sourceAuthority: 1 | 2, crossSourceCount: number): number {
    const base = FACT_TYPE_BASE[factType];
    const authorityBoost = sourceAuthority === 2 ? AUTHORITY_BOOST : 0;
    const corroborationBoost =
      Math.min(crossSourceCount - 1, CORROBORATION_BOOST_MAX_SOURCES) * CORROBORATION_BOOST_PER_SOURCE;
    return Math.max(0, Math.min(1, base + authorityBoost + corroborationBoost));
  }

  private key(field: FactField, value: string): string {
    return field + ':' + value.trim().toLowerCase();
  }
}
