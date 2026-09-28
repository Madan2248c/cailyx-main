import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { MAX_CACHED_TEXT, MAX_HEADINGS_PER_PAGE } from '../../discovery.constants.js';
import type { JsonLdEntity, PagePipelineState } from '../../discovery.types.js';
import { readPageState } from '../../discovery.types.js';
import type { DiscoveryRunContext } from '../pipeline-context.js';
import {
  asJson,
  extractJsonLd,
  extractServiceCandidates,
  extractValuePropCandidates,
  normalizeHeading,
  rawJsonLd,
  truncate,
} from '../pipeline-utils.js';
import { PrismaService } from '../../../../prisma/prisma.service.js';
import { FetcherService } from '../../../fetcher/fetcher.service.js';

/**
 * Everything the crawl records *about* a fetched page, rather than about the
 * company — kept together because all of it comes from the same one HTML
 * document and all of it is cheap.
 */
export interface PageSignals {
  title: string | null;
  description: string | null;
  headings: string[];
  language: string | null;
  jsonLd: JsonLdEntity[];
  /** Visible text, capped. The validate stage checks excerpts against this + `jsonLdRaw`. */
  cleanedText: string;
  jsonLdRaw: string | null;
  /**
   * Deterministic-extraction candidates, filtered here because only the DOM can
   * tell a service card from a team member's name. See
   * `extractServiceCandidates` in pipeline-utils.
   */
  serviceCandidates: string[];
  valuePropCandidates: string[];
}

/**
 * Read a page's metadata off the HTML already in hand.
 *
 * Ported verbatim from the old `stageInspect` body (its meta-description
 * precedence, heading cap, `slice(0, 5)` language truncation and title
 * fallback), plus the cleaned-text and JSON-LD capture the new schema needs.
 *
 * **Why this lives here and is called by the discover stage.** The design doc
 * says inspect works "from already-fetched HTML, no re-fetch" — true when the
 * old schema stored raw HTML per page. This module deliberately does not store
 * raw HTML (see docs/analysis/discovery.md "What we persist per page"), so the
 * only moment the HTML exists is inside the fetch that produced it. Discover
 * therefore calls this at insert time, which honours the rule's actual intent
 * (never pay for the same page twice) rather than its letter. Inspect keeps
 * ownership of the extraction logic and of the guarantee that every fetched
 * page has metadata — see its own `run()`.
 */
export function readPageSignals(html: string, text: string, title: string | null): PageSignals {
  const $ = cheerio.load(html);
  const headings: string[] = [];

  const description =
    ($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '')?.trim() || null;
  $('h1, h2, h3').each((_, el) => {
    const t = normalizeHeading($(el).text());
    if (t && headings.length < MAX_HEADINGS_PER_PAGE) headings.push(t);
  });

  return {
    title: title || $('title').text().trim() || null,
    description,
    headings,
    language: $('html').attr('lang')?.slice(0, 5) || null,
    jsonLd: extractJsonLd($),
    cleanedText: truncate(text || '', MAX_CACHED_TEXT),
    jsonLdRaw: rawJsonLd($),
    // Captured here, not in the extract stage, because the DOM is the only
    // place the heading level / card structure / team-block ancestry exists.
    serviceCandidates: extractServiceCandidates($),
    valuePropCandidates: extractValuePropCandidates($),
  };
}

/**
 * A page counts as inspected once its metadata keys have been written.
 * `!== undefined` (not truthiness) is the test: discover writes `title: null`
 * for a page with no `<title>`, and that is an inspected page, not a blind one.
 */
function isInspected(state: PagePipelineState): boolean {
  return state.title !== undefined && state.headings !== undefined;
}

/**
 * Inspect — metadata for every fetched page, and the page/run counts the rest
 * of the pipeline reports.
 *
 * In the normal path this stage has nothing to fetch: discover already recorded
 * each page's signals from the HTML it held (see {@link readPageSignals}), so
 * the loop below finds every page already inspected and does no work. It stays
 * a real stage because it is what *guarantees* that property — a page row that
 * predates this code, or that a partial write left without metadata, is
 * repaired here with a single re-fetch, and anything that cannot be repaired is
 * reported rather than silently treated as an empty page.
 */
@Injectable()
export class InspectStage {
  private readonly logger = new Logger(InspectStage.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fetcher: FetcherService,
  ) {}

  async run(ctx: DiscoveryRunContext): Promise<void> {
    const pages = await this.prisma.discoveredPage.findMany({
      where: { discoveryRunId: ctx.runId, fetchStatus: 'FETCHED' },
    });

    let repaired = 0;
    let unknown = 0;

    for (const page of pages) {
      const state = readPageState(page.pipelineState);
      if (isInspected(state)) continue; // already inspected on a prior attempt

      if (!ctx.budget.budgetLeft()) {
        unknown++;
        continue;
      }

      // No stored HTML to inspect (by design) — one re-fetch is the only way to
      // recover the metadata for a row that lacks it.
      ctx.budget.spendRequests(1);
      try {
        const res = await this.fetcher.render({ url: page.url, jsDisabled: false, timeout: 30000 }, 'discovery-inspect', ctx.runId);
        if (!res.html) {
          unknown++;
          continue;
        }
        const signals = readPageSignals(res.html, res.text, res.title);
        await this.prisma.discoveredPage.update({
          where: { id: page.id },
          data: {
            // Fill gaps only — never clobber content a good fetch already stored.
            cleanedText: page.cleanedText ?? signals.cleanedText,
            jsonLdRaw: page.jsonLdRaw ?? signals.jsonLdRaw,
            pipelineState: asJson({
              ...state,
              title: signals.title,
              description: signals.description,
              headings: signals.headings,
              language: signals.language,
              jsonLd: signals.jsonLd,
            }),
          },
        });
        repaired++;
      } catch (err) {
        this.logger.warn(`Discovery inspect repair failed for ${page.url}: ${(err as Error).message}`);
        unknown++;
      }
    }

    if (repaired > 0) {
      await ctx.note(`Inspect repaired metadata for ${repaired} page(s) that had none recorded at fetch time.`);
    }

    if (unknown > 0) {
      // §9.3: metadata unknown is not automatic exclusion — the select stage
      // still considers these pages, just without title/description/heading signal.
      await ctx.note(
        `${unknown} discovered page(s) had no metadata to inspect (fetch failed or repair budget exhausted). Treated as unknown metadata, not excluded.`,
      );
    }

    const discovered = await this.prisma.discoveredPage.count({ where: { discoveryRunId: ctx.runId } });
    const fetched = await this.prisma.discoveredPage.count({
      where: { discoveryRunId: ctx.runId, fetchStatus: { in: ['FETCHED', 'EXCLUDED'] } },
    });
    ctx.state.stats = { ...ctx.state.stats, pagesDiscovered: discovered, pagesFetched: fetched };

    await ctx.checkpoint();
  }
}
