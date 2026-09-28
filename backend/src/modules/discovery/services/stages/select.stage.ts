import { Injectable } from '@nestjs/common';
import { CATEGORY_PRIORITY, CATEGORY_TARGETS } from '../../discovery.constants.js';
import type { PageType, PurposeCategory } from '../../discovery.types.js';
import { PRISMA_TO_PAGE_TYPE, readPageState } from '../../discovery.types.js';
import type { DiscoveryRunContext } from '../pipeline-context.js';
import { asJson } from '../pipeline-utils.js';
import { PrismaService } from '../../../../prisma/prisma.service.js';

/**
 * Coverage-based selection (§9.4): rank within each purpose category, then fill
 * categories in priority order up to their reserved target — never just "top N
 * by score" across the whole pool, which is what would let eleven similar blog
 * posts crowd out the one pricing page. Login/cart/account/search, policy-only
 * and blog/news pages are never selected.
 *
 * A page the stage does not select is marked `EXCLUDED` rather than left
 * `FETCHED`, which is what makes "selected" and "fetchable" the same question
 * for every later stage: the extract stage reads `FETCHED` pages and needs no
 * second filter to avoid re-reading a page selection already rejected.
 * `priorityScore` records the page's rank *within its own category* (0 =
 * highest-ranked), which is the honest debugging signal for "why this page and
 * not that one" — it is not a cross-category score and nothing downstream
 * computes with it.
 */
@Injectable()
export class SelectStage {
  constructor(private readonly prisma: PrismaService) {}

  async run(ctx: DiscoveryRunContext): Promise<void> {
    const pages = await this.prisma.discoveredPage.findMany({
      where: { discoveryRunId: ctx.runId, fetchStatus: 'FETCHED' },
    });
    if (pages.some((p) => readPageState(p.pipelineState).selectionReason !== undefined)) return; // already selected on a prior attempt

    const byCategory = new Map<PurposeCategory, typeof pages>();
    for (const page of pages) {
      const purpose = purposeOf(PRISMA_TO_PAGE_TYPE[page.pageType]);
      if (purpose === null) continue;
      const list = byCategory.get(purpose) ?? [];
      list.push(page);
      byCategory.set(purpose, list);
    }

    // Within a category, shallower/shorter URLs first — "/services" beats
    // "/services/a/b/c" for offer language, and is less likely a deep near-duplicate.
    const rank = (a: { url: string }, b: { url: string }): number =>
      a.url.split('/').length - b.url.split('/').length || a.url.length - b.url.length;

    const coveragePlan: Record<string, { target: number; filled: number }> = {};
    const selectedIds = new Set<string>();
    /** Page id → rank within its category, for `priorityScore`. */
    const ranks = new Map<string, number>();

    for (const category of CATEGORY_PRIORITY) {
      const candidates = (byCategory.get(category) ?? []).slice().sort(rank);
      const target = CATEGORY_TARGETS[category];
      const take = candidates.slice(0, target);
      coveragePlan[category] = { target, filled: take.length };
      take.forEach((p, index) => {
        selectedIds.add(p.id);
        ranks.set(p.id, index);
      });
    }

    for (const page of pages) {
      const state = readPageState(page.pipelineState);
      const purpose = purposeOf(PRISMA_TO_PAGE_TYPE[page.pageType]);
      const selected = selectedIds.has(page.id);
      const reason = selected
        ? `Selected: ${purpose} page, coverage slot filled`
        : purpose === null
          ? `Excluded: ${PRISMA_TO_PAGE_TYPE[page.pageType]} page. Not a primary business-fact source`
          : `Excluded: coverage target for "${purpose}" pages already filled by a higher-ranked page`;
      await this.prisma.discoveredPage.update({
        where: { id: page.id },
        data: {
          fetchStatus: selected ? 'FETCHED' : 'EXCLUDED',
          priorityScore: ranks.get(page.id) ?? null,
          pipelineState: asJson({ ...state, selected, selectionReason: reason, purposeCategory: purpose }),
        },
      });
    }

    const filledCategories = Object.values(coveragePlan).filter((c) => c.filled > 0).length;
    if (filledCategories <= 1) {
      await ctx.note(
        `Coverage quality flag: only ${filledCategories} purpose categor${filledCategories === 1 ? 'y is' : 'ies are'} represented in the selected pages. This business's true offer surface may not be captured.`,
      );
    }

    ctx.state.coveragePlan = coveragePlan;
    await ctx.checkpoint();
  }
}

/** `null` = never selected: the always-excluded classes have no coverage slot. */
function purposeOf(pageType: PageType | null): PurposeCategory | null {
  if (pageType === null) return null;
  if (pageType === 'blog' || pageType === 'login' || pageType === 'cart' || pageType === 'policy') return null;
  return pageType;
}
