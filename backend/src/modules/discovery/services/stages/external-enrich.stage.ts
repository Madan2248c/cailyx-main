/**
 * Stage 8: External enrichment (spec §17).
 *
 * Targeted enrichment from the open web for a small fixed set of fields
 * (`headquarters`, `foundedYear`, `leadership`, `certification`, `award`) when
 * first-party extraction found nothing for them. Two queries, three results
 * each, and never a re-search for a field that already has a fact — the old
 * code's rule, kept because this spends real DataForSEO credits.
 *
 * Ported from the old repo's `aeo-context.service.ts`
 * `stageExternalEnrichment` (lines 1664–1685). Two adaptations, both from our
 * schema:
 *
 * - Facts are appended to `ctx.state.facts` rather than written as
 *   `SiteContextFact` rows; the search→fetch→extract→validate work itself is
 *   unchanged and still lives in `BoundedSearchService`.
 * - The old `run.externalEnrichment` opt-in flag has no analogue here. Our
 *   design puts the spend gate in the client instead (`DataForSeoSerpService`
 *   returns a typed "disabled" result unless credentials are present and
 *   `SWARM_ALLOW_LIVE=1`), so this stage always runs and reports honestly when
 *   it could not search — see docs/analysis/discovery.md "SERP fallback".
 *
 * @module discovery/services/stages/external-enrich
 */

import { Injectable } from '@nestjs/common';
import { EXTERNAL_ENRICHMENT_FIELDS, RESULTS_PER_SEARCH, SEARCHES_PER_FIELD } from '../../discovery.constants.js';
import type { DiscoveryRunContext } from '../pipeline-context.js';
import { BoundedSearchService } from '../bounded-search.service.js';
import { LlmService } from '../llm.service.js';

@Injectable()
export class ExternalEnrichStage {
  constructor(
    private readonly llm: LlmService,
    private readonly boundedSearch: BoundedSearchService,
  ) {}

  async run(ctx: DiscoveryRunContext): Promise<void> {
    // Checked before any search: without a model to read the fetched pages
    // there is nothing to gain from spending search credits, and the old code
    // gated on exactly this for exactly that reason.
    if (!this.llm.isAvailable()) return;

    const haveField = new Set((ctx.state.facts ?? []).filter((f) => f.validated).map((f) => f.field));
    const missing = EXTERNAL_ENRICHMENT_FIELDS.filter((f) => !haveField.has(f));
    if (missing.length === 0) return;

    const brand = ctx.project.name || ctx.project.domain;
    const queries = [
      `"${brand}" company headquarters founded`,
      `"${brand}" founder OR leadership OR "about us"`,
    ].slice(0, SEARCHES_PER_FIELD);

    const outcome = await this.boundedSearch.run(ctx, {
      label: 'External enrichment',
      brand,
      targetFields: missing,
      queries,
      maxResultsPerSearch: RESULTS_PER_SEARCH,
    });

    ctx.state.facts = [...(ctx.state.facts ?? []), ...outcome.facts];
  }
}
