/**
 * Stage 6 — Validate.
 *
 * The anti-hallucination backbone, and deliberately not an LLM pass: every fact's
 * excerpt must appear **verbatim** in the page it cites. A fact whose quote
 * cannot be found is dropped, not guessed at, and the run records how many.
 *
 * Ported from the old repo's `AeoContextService.stageValidate` + `normalizeText`.
 * The comparison is unchanged (collapse whitespace, trim, lowercase, then a
 * plain substring test). What changed is which text it compares against:
 *
 * - The old check ran against `text + html` because a JSON-LD-sourced excerpt
 *   only exists inside the raw `<script>` tag, which visible-text extraction
 *   strips out.
 * - This module persists no raw HTML, so the haystack is
 *   `cleaned_text + json_ld_raw` — the two places an excerpt can legitimately
 *   come from. Functionally equivalent for exactly the excerpt sources this
 *   pipeline has: heading/hero extraction quotes visible text, and JSON-LD
 *   extraction quotes JSON-LD text. See docs/analysis/discovery.md "What we
 *   persist per page".
 *
 * ## Merged facts have several sources, so support is per source
 *
 * Reconcile hands this stage one entry per field+value with every citing page
 * under it. A fact is supported when **at least one** of its sources contains
 * its quote verbatim — which is the same verdict the old per-row check reached,
 * since the old compile kept the value when any of its rows had validated.
 *
 * External facts (added by the bounded-search stages, which run *after* this
 * one and verbatim-check their own pages at extraction time) are therefore
 * never re-validated here, which is also what the old stage ordering did.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service.js';
import type { ReconciledFact } from '../../discovery.types.js';
import { normalizeForMatch } from '../pipeline-utils.js';
import type { DiscoveryRunContext } from '../pipeline-context.js';

@Injectable()
export class ValidateStage {
  constructor(private readonly prisma: PrismaService) {}

  /** Every assertion must be supported by its own cited page's text — never a different page's. */
  async run(ctx: DiscoveryRunContext): Promise<void> {
    const facts = ctx.state.facts ?? [];
    if (facts.length === 0) return;

    const pages = await this.prisma.discoveredPage.findMany({
      where: { discoveryRunId: ctx.runId },
      orderBy: { url: 'asc' },
    });
    // Both halves of what we persisted: visible text, and the raw JSON-LD
    // blocks that visible-text extraction strips out.
    const textByUrl = new Map(
      pages.map((page) => [page.url, normalizeForMatch((page.cleanedText || '') + ' ' + (page.jsonLdRaw || ''))]),
    );

    let dropped = 0;
    for (const fact of facts) {
      if (fact.validationNote?.startsWith('Reconcile:')) continue; // already excluded in stage 5

      const verdict = this.check(fact, textByUrl);
      fact.validated = verdict.supported;
      fact.validationNote = verdict.note;
      if (!verdict.supported) dropped++;
    }

    if (dropped > 0) {
      await ctx.note(
        `Validation dropped ${dropped} unsupported assertion(s). They will not appear in the candidate profile.`,
      );
    }
  }

  /**
   * Support check across every page citing this fact.
   *
   * `supported` is true when one or more citing pages verbatim-contains the
   * quote. The note distinguishes the two failure modes the old stage
   * distinguished — no text to check against at all, vs. text that does not
   * contain the quote — because they call for different fixes (a fetch problem
   * vs. a model that paraphrased).
   */
  private check(fact: ReconciledFact, textByUrl: Map<string, string>): { supported: boolean; note: string | null } {
    let checkedAnyPage = false;
    for (const source of fact.sources) {
      const pageText = textByUrl.get(source.url);
      // Nothing to check against: no row for that URL, or a row we stored no
      // text for. The old stage treated both as "no cached text" (its check was
      // falsy-based), and the distinction matters — this is a fetch problem,
      // not a model that paraphrased.
      if (pageText === undefined || pageText.length === 0) continue;
      checkedAnyPage = true;
      const needle = normalizeForMatch(source.excerpt || fact.value);
      if (needle.length > 0 && pageText.includes(needle)) {
        return { supported: true, note: null };
      }
    }
    if (!checkedAnyPage) return { supported: false, note: 'No cached text for the cited page.' };
    return { supported: false, note: "Excerpt not found verbatim in the cited page's text." };
  }
}
