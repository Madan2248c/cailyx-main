import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CATEGORY_TARGETS } from '../../discovery.constants.js';
import { PrismaService } from '../../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../../test/mocks/prisma.mock.js';
import { RunBudget, type DiscoveryRunContext } from '../pipeline-context.js';
import { SelectStage } from './select.stage.js';

const RUN_ID = 'run-1';
const limits = { maxPages: 12, maxRequests: 40, maxChars: 24_000, maxElapsedMs: 300_000, maxRetriesPerPage: 2 };

type StoredPageType = 'HOMEPAGE' | 'SERVICE' | 'PRICING' | 'ABOUT' | 'BLOG' | 'CASE_STUDY' | 'SECURITY';

function page(id: string, url: string, pageType: StoredPageType, pipelineState: Record<string, unknown> = {}) {
  return { id, url, pageType, fetchStatus: 'FETCHED', pipelineState, createdAt: new Date() };
}

/** id → the row the stage wrote for it. */
function updatesById(
  prisma: PrismaMock,
): Map<string, { fetchStatus?: string; priorityScore?: number | null; pipelineState: Record<string, unknown> }> {
  const out = new Map<string, { fetchStatus?: string; priorityScore?: number | null; pipelineState: Record<string, unknown> }>();
  for (const call of prisma.discoveredPage.update.mock.calls) {
    const arg = call[0] as { where: { id: string }; data: Record<string, unknown> };
    out.set(arg.where.id, {
      fetchStatus: arg.data.fetchStatus as string | undefined,
      priorityScore: arg.data.priorityScore as number | null | undefined,
      pipelineState: arg.data.pipelineState as Record<string, unknown>,
    });
  }
  return out;
}

describe('SelectStage', () => {
  let stage: SelectStage;
  let prisma: PrismaMock;
  let notes: string[];

  function context(): DiscoveryRunContext {
    return {
      runId: RUN_ID,
      project: { id: 'project-1', name: 'Acme', domain: 'acme.com' },
      budget: new RunBudget({ pages: 0, requests: 0, chars: 0, elapsedMs: 0 }, { ...limits }),
      state: {},
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      note: vi.fn(async (text: string) => {
        notes.push(text);
      }),
      checkpoint: vi.fn(async () => {}),
    };
  }

  beforeEach(async () => {
    prisma = createPrismaMock();
    prisma.discoveredPage.findMany.mockResolvedValue([]);
    notes = [];

    const moduleRef = await Test.createTestingModule({
      providers: [SelectStage, { provide: PrismaService, useValue: asPrismaService(prisma) }],
    }).compile();

    stage = moduleRef.get(SelectStage);
  });

  it('never lets a pile of blog posts crowd out the one pricing page', async () => {
    const blogs = Array.from({ length: 11 }, (_, i) => page(`blog-${i}`, `https://acme.com/blog/post-${i}`, 'BLOG'));
    prisma.discoveredPage.findMany.mockResolvedValue([
      page('home', 'https://acme.com/', 'HOMEPAGE'),
      page('pricing', 'https://acme.com/pricing', 'PRICING'),
      ...blogs,
    ]);

    const ctx = context();
    await stage.run(ctx);

    const updates = updatesById(prisma);
    expect(updates.get('home')!.fetchStatus).toBe('FETCHED');
    expect(updates.get('pricing')!.fetchStatus).toBe('FETCHED');
    // A blog page has no coverage slot at all — it is never a fact source.
    expect(updates.get('blog-3')!.fetchStatus).toBe('EXCLUDED');
    expect(updates.get('blog-3')!.pipelineState.purposeCategory).toBeNull();
    expect(ctx.state.coveragePlan).toMatchObject({
      homepage: { target: CATEGORY_TARGETS.homepage, filled: 1 },
      pricing: { target: CATEGORY_TARGETS.pricing, filled: 1 },
    });
  });

  it('ranks within a category by shallower then shorter URL', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([
      page('deep', 'https://acme.com/services/tax/uk/london', 'SERVICE'),
      page('shallow', 'https://acme.com/services', 'SERVICE'),
      page('mid', 'https://acme.com/services/tax', 'SERVICE'),
      page('other', 'https://acme.com/products', 'SERVICE'),
      page('fifth', 'https://acme.com/capabilities', 'SERVICE'),
    ]);

    await stage.run(context());

    const updates = updatesById(prisma);
    // priorityScore is the rank within the category, so 0 is the page that fills
    // the first slot — shallower beats deeper, and a tie breaks on URL length.
    expect(updates.get('shallow')!.priorityScore).toBe(0);
    expect(updates.get('other')!.priorityScore).toBe(1);
    expect(updates.get('fifth')!.priorityScore).toBe(2);
    expect(updates.get('mid')!.priorityScore).toBe(3);
    // Five candidates for four service slots: the deepest is dropped.
    expect(updates.get('deep')!.priorityScore).toBeNull();
    expect(updates.get('deep')!.fetchStatus).toBe('EXCLUDED');
    expect(updates.get('shallow')!.pipelineState.purposeCategory).toBe('service');
  });

  it('flags a run whose selected pages cover only one purpose category', async () => {
    // One purpose category represented at all — the flag is about the shape of
    // the coverage, not about how many pages were selected.
    prisma.discoveredPage.findMany.mockResolvedValue([
      page('svc-1', 'https://acme.com/services', 'SERVICE'),
      page('svc-2', 'https://acme.com/solutions', 'SERVICE'),
    ]);

    await stage.run(context());

    expect(notes.some((note) => note.includes('Coverage quality flag'))).toBe(true);
  });

  it('does not re-select pages that were already selected on a prior attempt', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([
      page('home', 'https://acme.com/', 'HOMEPAGE', { selected: true, selectionReason: 'Selected: homepage page, coverage slot filled' }),
    ]);

    await stage.run(context());

    expect(prisma.discoveredPage.update).not.toHaveBeenCalled();
  });

  it('explains every exclusion so an operator can see why a page was skipped', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([
      page('home', 'https://acme.com/', 'HOMEPAGE'),
      page('policy', 'https://acme.com/privacy', 'SECURITY'),
      page('svc-1', 'https://acme.com/services', 'SERVICE'),
      page('svc-2', 'https://acme.com/solutions', 'SERVICE'),
      page('svc-3', 'https://acme.com/products', 'SERVICE'),
      page('svc-4', 'https://acme.com/what-we-do', 'SERVICE'),
      page('svc-5', 'https://acme.com/capabilities', 'SERVICE'),
    ]);

    await stage.run(context());

    const updates = updatesById(prisma);
    // Four service slots, five candidates: exactly one is dropped, with a reason.
    const dropped = [...updates.entries()].filter(([, value]) => value.pipelineState.selected === false);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]![1].pipelineState.selectionReason).toContain('coverage target');
  });
});
