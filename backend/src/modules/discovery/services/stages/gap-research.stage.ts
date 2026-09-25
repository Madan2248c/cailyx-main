/**
 * Stage 10: Gap research (spec §19).
 *
 * A bounded research pass over *only* the fields consolidation itself flagged
 * as missing — never a "find everything about the company" sweep. Runs after
 * consolidation precisely so it has those gaps to work from, and shares the
 * exact same search→fetch→extract→verbatim-validate engine as external
 * enrichment; the two differ only in which fields they target and why.
 *
 * Ported from the old repo's `aeo-context.service.ts` `stageGapResearch`
 * (lines 1838–1875), with the two schema adaptations described in
 * `ExternalEnrichStage` (state instead of rows, no opt-in flag) plus one
 * behavioural narrowing: when new facts land, the old code deleted every
 * category summary and re-ran the whole consolidation pass; here only the
 * categories whose own gaps were researched are re-summarised. The remaining
 * categories were built from facts that did not change, so their summaries are
 * still correct.
 *
 * The spec's ordering is preserved: §18 consolidation → §19 gap research →
 * §20 *final* synthesis, so the synthesis a consumer sees already accounts for
 * whatever gap research found.
 *
 * @module discovery/services/stages/gap-research
 */

import { Injectable } from '@nestjs/common';
import { GAP_RESEARCH_MAX_FIELDS, RESULTS_PER_SEARCH, SEARCHES_PER_FIELD } from '../../discovery.constants.js';
import type { FactField } from '../../discovery.types.js';
import type { DiscoveryRunContext } from '../pipeline-context.js';
import { BoundedSearchService } from '../bounded-search.service.js';
import { ConsolidateStage } from './consolidate.stage.js';
import { LlmService } from '../llm.service.js';

@Injectable()
export class GapResearchStage {
  constructor(
    private readonly llm: LlmService,
    private readonly boundedSearch: BoundedSearchService,
    private readonly consolidate: ConsolidateStage,
  ) {}

  async run(ctx: DiscoveryRunContext): Promise<void> {
    if (!this.llm.isAvailable()) return;

    const summaries = ctx.state.summaries ?? [];
    const gapFields = new Set<FactField>();
    for (const s of summaries) {
      for (const f of s.missingFields) gapFields.add(f);
    }
    const targetFields = [...gapFields].slice(0, GAP_RESEARCH_MAX_FIELDS);
    if (targetFields.length === 0) {
      await ctx.note('Gap research: no missing fields to research — consolidation found no gaps.');
      return;
    }

    const brand = ctx.project.name || ctx.project.domain;
    const queries = [
      `"${brand}" ${targetFields.slice(0, 3).join(' ')}`,
      `"${brand}" ${targetFields.slice(3).join(' ')}`,
    ]
      .filter((q) => q.trim() !== `"${brand}"`)
      .slice(0, SEARCHES_PER_FIELD);

    const { stored, facts } = await this.boundedSearch.run(ctx, {
      label: 'Gap research',
      brand,
      targetFields,
      queries,
      maxResultsPerSearch: RESULTS_PER_SEARCH,
    });

    ctx.state.facts = [...(ctx.state.facts ?? []), ...facts];

    if (stored > 0) {
      // Only categories whose own gaps were researched: their summaries were
      // built without the facts we just added, so they are the stale ones.
      const researched = new Set<string>(targetFields);
      const affected = summaries
        .filter((s) => s.missingFields.some((f) => researched.has(f)))
        .map((s) => s.category);
      await this.consolidate.runForCategories(ctx, affected);
      await ctx.note(`Gap research: category summaries refreshed to include ${stored} newly filled field(s).`);
    }
  }
}
