/**
 * The bounded search → fetch → extract → verbatim-validate engine.
 *
 * Ported from the old repo's `aeo-context.service.ts`
 * `runBoundedSearchExtraction` (lines 1697–1837) as-is, with persistence
 * adapted: the old method wrote `SiteContextFact` rows directly; here it
 * returns validated facts for the caller to append to `ctx.state.facts`, so
 * this one engine serves both callers — `ExternalEnrichStage` (spec §17) and
 * `GapResearchStage` (spec §19) — exactly as it did before.
 *
 * What the two callers differ in is only which fields they are after and which
 * queries they run to find them; spec §19's own constraint list ("exact fields
 * to resolve... maximum searches... a stopping condition") is exactly this
 * method's parameters.
 *
 * Two rules from the spec are enforced here and must not be relaxed:
 *
 * - **A page found by search is never first-party.** Its facts are capped at
 *   {@link EXTERNAL_FACT_CONFIDENCE_CAP} regardless of how explicit the source
 *   reads, so consolidation can always tell a claim the company made about
 *   itself from one a third party made about it.
 * - **No benefit of the doubt for an external source.** A fact is stored only
 *   if its cited excerpt is found verbatim in the fetched page's own text — the
 *   same discipline the validate stage applies to first-party facts, applied
 *   here because these pages are not in the run's own page table.
 *
 * @module discovery/services/bounded-search
 */

import { Injectable, Logger } from '@nestjs/common';
import { EXTERNAL_FACT_CONFIDENCE_CAP, MAX_BATCH_CHARS } from '../discovery.constants.js';
import type { DraftFact, FactField, ReconciledFact } from '../discovery.types.js';
import type { DiscoveryRunContext } from './pipeline-context.js';
import { cleanValueList, normalizeForMatch } from './pipeline-utils.js';
import { DataForSeoSerpService } from './dataforseo-serp.service.js';
import { FetcherService } from '../../fetcher/fetcher.service.js';
import { LlmService } from '../../llm/llm.service.js';

/** One bounded pass: what it is for, what it wants, and how to find it. */
export interface BoundedSearchOptions {
  /** Shown in every note and log line, e.g. `External enrichment`. */
  label: string;
  brand: string;
  /** The only fields this pass is allowed to produce. */
  targetFields: FactField[];
  /** Run verbatim, in order. The caller owns capping this list. */
  queries: string[];
  maxResultsPerSearch: number;
}

export interface BoundedSearchOutcome {
  /** Verbatim-validated facts, ready to append to `ctx.state.facts`. */
  facts: ReconciledFact[];
  stored: number;
  queriesRun: number;
  costUsd: number;
  /** How many distinct external pages were fetched and searched. */
  pagesFetched: number;
}

@Injectable()
export class BoundedSearchService {
  private readonly logger = new Logger(BoundedSearchService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly dataForSeoSerp: DataForSeoSerpService,
    private readonly fetcher: FetcherService,
  ) {}

  /**
   * Run one bounded pass. Never throws: a failed search, fetch or extraction is
   * reported as a note and an empty result, because both callers are
   * enrichment — neither is allowed to fail the run they are part of.
   */
  async run(ctx: DiscoveryRunContext, opts: BoundedSearchOptions): Promise<BoundedSearchOutcome> {
    const { label, brand, targetFields, queries, maxResultsPerSearch } = opts;
    let searchesUsed = 0;
    let searchCostUsd = 0;
    const fetchedByUrl = new Map<string, string>();
    const corpusParts: string[] = [];

    for (const query of queries) {
      const lookup = await this.dataForSeoSerp.search(query);
      searchesUsed++;
      searchCostUsd += lookup.costUsd;
      if (lookup.skipped) {
        await ctx.note(`${label}: search skipped; ${lookup.skipped}`);
        continue;
      }
      for (const link of lookup.links.slice(0, maxResultsPerSearch)) {
        if (fetchedByUrl.has(link.url)) continue;
        try {
          const page = await this.fetcher.render(
            { url: link.url, jsDisabled: false, timeout: 20_000 },
            'discovery-external',
            ctx.runId,
          );
          const text = (page.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_BATCH_CHARS);
          if (text) {
            fetchedByUrl.set(link.url, text);
            corpusParts.push(`\n\n--- ${link.url} ---\n${page.title ? page.title + '\n' : ''}${text}`);
          }
        } catch (err) {
          this.logger.warn(`${label}: fetch failed for ${link.url}: ${(err as Error).message}`);
        }
      }
    }

    this.recordSpend(ctx, searchesUsed, searchCostUsd, targetFields);

    if (corpusParts.length === 0) {
      await ctx.note(`${label}: no fetchable external pages found.`);
      return { facts: [], stored: 0, queriesRun: searchesUsed, costUsd: searchCostUsd, pagesFetched: 0 };
    }

    try {
      const result = await this.llm.json(
        {
          purpose: label.toLowerCase(),
          maxTokens: 1200,
          system:
            `You read pages found via web search about a company, NOT its own site, and extract only facts about "${brand}" ` +
            'itself, never about a different company the page also mentions in passing. Only extract these fields, and ' +
            'only if clearly stated: ' + targetFields.join(', ') + '.\n' +
            '- Every fact MUST cite the exact page URL it came from (sourcePage, must be one of the URLs given) and a ' +
            'short verbatim excerpt (<=200 chars, copied text, not a paraphrase) that supports it.\n' +
            '- Return [] for anything not clearly and directly stated. Never infer or guess for an external source.\n' +
            'Respond with ONLY JSON: {"facts":[{"field":string,"value":string,"sourcePage":string,"excerpt":string}]}',
          user: `Pages found via web search, about "${brand}":` + corpusParts.join(''),
        },
        (raw) => this.validateExternalFacts(raw, [...fetchedByUrl.keys()], targetFields),
      );

      const facts: ReconciledFact[] = [];
      for (const f of result.data) {
        const pageText = fetchedByUrl.get(f.sourceUrl);
        const needle = normalizeForMatch(f.excerpt || f.value);
        const supported = !!pageText && needle.length > 0 && normalizeForMatch(pageText).includes(needle);
        if (!supported) continue; // no benefit of the doubt for an external source — verbatim or dropped
        facts.push({
          field: f.field,
          value: f.value,
          factType: 'explicit',
          // Capped below a first-party explicit fact's base — a single external
          // source is not the subject's own site, however plainly it reads.
          confidence: EXTERNAL_FACT_CONFIDENCE_CAP,
          sources: [
            {
              url: f.sourceUrl,
              pageType: null, // not one of our crawled pages — the classifier never saw it
              excerpt: f.excerpt,
              fetchedAt: new Date().toISOString(),
              contentHash: null,
            },
          ],
          sourceType: 'external',
          validated: true,
          validationNote: null,
        });
      }

      await ctx.note(
        `${label}: ${facts.length} fact(s) added from ${fetchedByUrl.size} external page(s), ${searchesUsed} search(es), $${searchCostUsd.toFixed(4)}.`,
      );
      await ctx.note(`__cost__:${result.costUsd}:${result.model}`);

      return {
        facts,
        stored: facts.length,
        queriesRun: searchesUsed,
        costUsd: searchCostUsd,
        pagesFetched: fetchedByUrl.size,
      };
    } catch (err) {
      this.logger.warn(`${label}: extraction failed for run ${ctx.runId}: ${(err as Error).message}`);
      return { facts: [], stored: 0, queriesRun: searchesUsed, costUsd: searchCostUsd, pagesFetched: fetchedByUrl.size };
    }
  }

  /**
   * Accumulate search spend on the run so it survives a job re-enqueue — the
   * old code kept `searchesUsed`/`searchCostUsd` as run columns; ours lives in
   * `pipeline_state.search`. `fieldsSearched` records every field this run has
   * ever searched for, which is what makes "did we already pay for this
   * field?" answerable from persisted state rather than memory.
   */
  private recordSpend(ctx: DiscoveryRunContext, queriesRun: number, costUsd: number, targetFields: FactField[]): void {
    const search = (ctx.state.search ??= { queriesRun: 0, costUsd: 0, fieldsSearched: [] });
    search.queriesRun += queriesRun;
    search.costUsd += costUsd;
    search.fieldsSearched = cleanValueList([...search.fieldsSearched, ...targetFields]);
  }

  /**
   * Trust boundary for the extraction call: only a known field, a URL we
   * actually fetched, and a non-empty value survive. Ported verbatim — the
   * `urlSet` check is what stops a model from citing a page it never saw.
   */
  private validateExternalFacts(raw: unknown, allowedUrls: string[], allowedFields: FactField[]): DraftFact[] {
    const obj = (raw ?? {}) as { facts?: unknown };
    if (!Array.isArray(obj.facts)) return [];
    const urlSet = new Set(allowedUrls);
    const fieldSet = new Set(allowedFields);
    const out: DraftFact[] = [];
    for (const entry of obj.facts) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const field = typeof e.field === 'string' ? (e.field as FactField) : null;
      const sourceUrl = typeof e.sourcePage === 'string' ? e.sourcePage : '';
      const value = typeof e.value === 'string' ? e.value.trim().slice(0, 300) : '';
      if (!field || !fieldSet.has(field) || !urlSet.has(sourceUrl) || !value) continue;
      out.push({
        field,
        value,
        sourceUrl,
        excerpt: typeof e.excerpt === 'string' ? e.excerpt.trim().slice(0, 200) : null,
        contentHash: null,
      });
    }
    return out.slice(0, 20);
  }
}
