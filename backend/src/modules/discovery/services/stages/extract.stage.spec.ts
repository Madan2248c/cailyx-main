import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXTRACT_BATCH_SIZE, MAX_BATCH_CHARS } from '../../discovery.constants.js';
import type { PagePipelineState } from '../../discovery.types.js';
import { PrismaService } from '../../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../../test/mocks/prisma.mock.js';
import { LlmService } from '../llm.service.js';
import { RunBudget, RunPausedException, type DiscoveryRunContext } from '../pipeline-context.js';
import { ExtractStage } from './extract.stage.js';

const RUN_ID = 'run-1';
const SERVICE_URL = 'https://acme.com/services';
const limits = { maxPages: 12, maxRequests: 40, maxChars: 24_000, maxElapsedMs: 300_000, maxRetriesPerPage: 2 };

type StoredPageType = 'HOMEPAGE' | 'SERVICE' | 'PRICING' | 'BLOG' | 'LEADERSHIP';

function page(
  overrides: {
    id?: string;
    url?: string;
    pageType?: StoredPageType;
    cleanedText?: string | null;
    jsonLdRaw?: string | null;
    contentHash?: string | null;
    state?: PagePipelineState;
  } = {},
) {
  return {
    id: overrides.id ?? 'page-1',
    url: overrides.url ?? SERVICE_URL,
    pageType: overrides.pageType ?? ('SERVICE' as StoredPageType),
    cleanedText: overrides.cleanedText ?? 'We offer tax planning and wealth management.',
    jsonLdRaw: overrides.jsonLdRaw ?? null,
    contentHash: overrides.contentHash ?? '1:10',
    fetchStatus: 'FETCHED',
    createdAt: new Date(),
    pipelineState: { selected: true, ...overrides.state } as Record<string, unknown>,
  };
}

/** The last state the stage wrote for a page id — what the next stage will read. */
function savedState(prisma: PrismaMock, pageId: string): PagePipelineState | undefined {
  const calls = prisma.discoveredPage.update.mock.calls.filter(
    (call) => (call[0] as { where: { id: string } }).where.id === pageId,
  );
  const last = calls.at(-1);
  return last ? ((last[0] as { data: { pipelineState: PagePipelineState } }).data.pipelineState as PagePipelineState) : undefined;
}

describe('ExtractStage', () => {
  let stage: ExtractStage;
  let prisma: PrismaMock;
  let llm: { isAvailable: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  let notes: string[];
  let warnings: string[];

  function context(overrides: Partial<typeof limits> = {}): DiscoveryRunContext {
    return {
      runId: RUN_ID,
      project: { id: 'project-1', name: 'Acme', domain: 'acme.com' },
      budget: new RunBudget({ pages: 0, requests: 0, chars: 0, elapsedMs: 0 }, { ...limits, ...overrides }),
      state: {},
      logger: {
        log: vi.fn(),
        warn: vi.fn((message: string) => warnings.push(message)),
        error: vi.fn(),
        debug: vi.fn(),
      } as never,
      note: vi.fn(async (text: string) => {
        notes.push(text);
      }),
      checkpoint: vi.fn(async () => {}),
    };
  }

  /** Make the LLM answer every batch with the given raw payload through the real validator. */
  function llmReturns(raw: unknown): void {
    llm.json.mockImplementation(async (_req: unknown, validate: (raw: unknown) => unknown) => ({
      data: validate(raw),
      model: 'test-model',
      provider: 'openrouter',
      costUsd: 0.001,
      costIsReported: true,
    }));
  }

  beforeEach(async () => {
    prisma = createPrismaMock();
    prisma.discoveredPage.findMany.mockResolvedValue([]);
    llm = { isAvailable: vi.fn(() => true), json: vi.fn() };
    notes = [];
    warnings = [];

    const moduleRef = await Test.createTestingModule({
      providers: [
        ExtractStage,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: LlmService, useValue: llm },
      ],
    }).compile();

    stage = moduleRef.get(ExtractStage);
  });

  describe('deterministic pass', () => {
    it('turns service candidates on an offering page into services facts', async () => {
      prisma.discoveredPage.findMany.mockResolvedValue([
        page({ state: { serviceCandidates: ['Tax Planning', 'Wealth Management'], extractStatus: 'pending' } }),
      ]);
      llmReturns({ facts: [] });

      await stage.run(context());

      const facts = savedState(prisma, 'page-1')?.facts ?? [];
      expect(facts.map((f) => [f.field, f.value])).toEqual([
        ['services', 'Tax Planning'],
        ['services', 'Wealth Management'],
      ]);
      // The excerpt has to be the value itself — validate checks it verbatim
      // against the page text, so a paraphrase here would drop the fact.
      expect(facts[0]!.excerpt).toBe('Tax Planning');
      expect(facts[0]!.sourceUrl).toBe(SERVICE_URL);
    });

    it('does not read candidates as offerings on a page type that never sells', async () => {
      prisma.discoveredPage.findMany.mockResolvedValue([
        page({
          url: 'https://acme.com/blog/post',
          pageType: 'BLOG',
          state: { serviceCandidates: ['Tax Planning'], valuePropCandidates: ['We help teams grow faster'], extractStatus: 'pending' },
        }),
      ]);
      llmReturns({ facts: [] });

      await stage.run(context());

      const facts = savedState(prisma, 'page-1')?.facts ?? [];
      expect(facts).toEqual([]);
    });

    it('produces value props only on homepage/service/pricing pages', async () => {
      prisma.discoveredPage.findMany.mockResolvedValue([
        page({ id: 'home', url: 'https://acme.com/', pageType: 'HOMEPAGE', state: { valuePropCandidates: ['We help founders grow'], extractStatus: 'pending' } }),
        page({ id: 'blog', url: 'https://acme.com/blog/x', pageType: 'BLOG', state: { valuePropCandidates: ['We help founders grow'], extractStatus: 'pending' } }),
      ]);
      llmReturns({ facts: [] });

      await stage.run(context());

      expect((savedState(prisma, 'home')?.facts ?? []).map((f) => f.field)).toEqual(['valueProps']);
      expect(savedState(prisma, 'blog')?.facts ?? []).toEqual([]);
    });

    it('cites a JSON-LD fact with the raw markup text, not a re-serialization', async () => {
      prisma.discoveredPage.findMany.mockResolvedValue([
        page({
          state: {
            extractStatus: 'pending',
            jsonLd: [
              {
                type: 'Organization',
                fields: { legalName: 'Acme Ltd', address: { addressLocality: 'Leeds', addressCountry: 'GB' } },
              },
            ],
          },
        }),
      ]);
      llmReturns({ facts: [] });

      await stage.run(context());

      const facts = savedState(prisma, 'page-1')?.facts ?? [];
      expect(facts.map((f) => [f.field, f.value])).toEqual([
        ['legalName', 'Acme Ltd'],
        ['headquarters', 'Leeds, GB'],
      ]);
      // Validated against one literal part of the address, never the joined
      // string — the join is our own formatting and appears nowhere in the page.
      expect(facts[1]!.excerpt).toBe('Leeds');
    });

    // Regression test for a defect found in a live run: a product page's
    // `Product` JSON-LD block contributed its product name ("Resend marketing
    // emails") as the company `brand`, alongside the real one from the
    // Organization block. Because `brand` is a singular field, that made the
    // profile's own business name `conflicted` and depressed its confidence.
    it('does not take the brand name from a product or service entity', async () => {
      prisma.discoveredPage.findMany.mockResolvedValue([
        page({
          state: {
            extractStatus: 'pending',
            jsonLd: [
              { type: 'Organization', fields: { name: 'Acme' } },
              { type: 'Product', fields: { name: 'Acme Analytics Pro' } },
              { type: 'Service', fields: { name: 'Acme Managed Reporting' } },
            ],
          },
        }),
      ]);
      llmReturns({ facts: [] });

      await stage.run(context());

      const brands = (savedState(prisma, 'page-1')?.facts ?? []).filter((f) => f.field === 'brand');
      expect(brands.map((f) => f.value)).toEqual(['Acme']);
    });

    it('caps how many facts one page can carry', async () => {
      const candidates = Array.from({ length: 60 }, (_, i) => `Service Offering ${i}`);
      prisma.discoveredPage.findMany.mockResolvedValue([
        page({ state: { serviceCandidates: candidates, extractStatus: 'pending' } }),
      ]);
      llmReturns({ facts: [] });

      await stage.run(context());

      // 60 candidates in, a bounded number persisted — the row has to stay small.
      expect((savedState(prisma, 'page-1')?.facts ?? []).length).toBeLessThanOrEqual(60);
    });

    it('ignores pages the select stage did not choose', async () => {
      prisma.discoveredPage.findMany.mockResolvedValue([
        page({ state: { selected: false, serviceCandidates: ['Tax Planning'], extractStatus: 'pending' } }),
      ]);
      llmReturns({ facts: [] });

      await stage.run(context());

      expect(prisma.discoveredPage.update).not.toHaveBeenCalled();
      expect(llm.json).not.toHaveBeenCalled();
    });
  });

  describe('LLM pass', () => {
    it('marks every pending page done and spends nothing when no provider is configured', async () => {
      llm.isAvailable.mockReturnValue(false);
      prisma.discoveredPage.findMany.mockResolvedValue([
        page({ id: 'a', url: 'https://acme.com/a', state: { extractStatus: 'pending' } }),
        page({ id: 'b', url: 'https://acme.com/b', state: { extractStatus: 'pending' } }),
      ]);

      await stage.run(context());

      expect(llm.json).not.toHaveBeenCalled();
      expect(savedState(prisma, 'a')?.extractStatus).toBe('done');
      expect(savedState(prisma, 'b')?.extractStatus).toBe('done');
    });

    it('batches pages and tells the model which pages are organizational', async () => {
      prisma.discoveredPage.findMany.mockResolvedValue([
        page({ id: 'svc', url: 'https://acme.com/services', state: { extractStatus: 'pending' } }),
        page({
          id: 'team',
          url: 'https://acme.com/team',
          pageType: 'LEADERSHIP',
          cleanedText: 'Join our team as a marketing intern.',
          state: { extractStatus: 'pending' },
        }),
      ]);
      llmReturns({ facts: [] });

      await stage.run(context());

      expect(llm.json).toHaveBeenCalledTimes(1);
      const req = llm.json.mock.calls[0]![0] as { user: string; system: string };
      expect(req.user).toContain('https://acme.com/team');
      // The page-type bar travels with the page, so the model cannot read a
      // careers page's copy as something the company sells.
      expect(req.user).toContain('[page type: leadership');
      expect(req.system).toContain('internal/organizational page');
    });

    // The prompt is the only lever on what the model calls an offering, so its
    // exclusions are pinned here: without them a marketing page's section
    // headings ("Integrate tonight", "Beyond expectations") come back as
    // services, which is what a live run on a real site produced.
    it('tells the model that marketing copy is not an offering', async () => {
      prisma.discoveredPage.findMany.mockResolvedValue([
        page({ state: { extractStatus: 'pending' } }),
      ]);
      llmReturns({ facts: [] });

      await stage.run(context());

      const req = llm.json.mock.calls[0]![0] as { system: string };
      expect(req.system).toContain('could put it on an invoice');
      expect(req.system).toContain('calls to action');
      expect(req.system).toContain('benefit and quality claims');
      // Third-party voices are not the company's own claims, and another
      // company's executive is not this company's leadership.
      expect(req.system).toContain("Only the COMPANY's own claim");
      expect(req.system).toContain('is Y\'s leadership, not this company\'s');
    });

    it('never puts more than the batch size into one call', async () => {
      const pages = Array.from({ length: EXTRACT_BATCH_SIZE + 1 }, (_, i) =>
        page({ id: `p${i}`, url: `https://acme.com/p${i}`, state: { extractStatus: 'pending' } }),
      );
      prisma.discoveredPage.findMany.mockResolvedValue(pages);
      llmReturns({ facts: [] });

      await stage.run(context());

      expect(llm.json).toHaveBeenCalledTimes(2);
      const first = (llm.json.mock.calls[0]![0] as { user: string }).user;
      expect(first.split('--- ').length - 1).toBe(EXTRACT_BATCH_SIZE);
    });

    it('keeps a fact only when its cited page was in the batch it came from', async () => {
      prisma.discoveredPage.findMany.mockResolvedValue([page({ url: SERVICE_URL, state: { extractStatus: 'pending' } })]);
      llmReturns({
        facts: [
          { field: 'services', value: 'Audit', sourcePage: SERVICE_URL, excerpt: 'Audit', factType: 'explicit' },
          // A hallucinated citation — dropped, never trusted.
          { field: 'services', value: 'Invented', sourcePage: 'https://elsewhere.com/x', excerpt: 'Invented', factType: 'explicit' },
          { field: 'markets', value: 'United Kingdom', sourcePage: SERVICE_URL, excerpt: 'UK', factType: 'explicit' },
          { field: 'notAField', value: 'x', sourcePage: SERVICE_URL, excerpt: 'x', factType: 'explicit' },
        ],
      });

      await stage.run(context());

      const facts = savedState(prisma, 'page-1')?.facts ?? [];
      expect(facts.map((f) => [f.field, f.value, f.factType])).toEqual([['services', 'Audit', 'explicit']]);
    });

    it('stops at the character budget and says how much was left undone', async () => {
      const pages = Array.from({ length: 5 }, (_, i) =>
        page({ id: `p${i}`, url: `https://acme.com/p${i}`, cleanedText: 'x'.repeat(400), state: { extractStatus: 'pending' } }),
      );
      prisma.discoveredPage.findMany.mockResolvedValue(pages);
      llmReturns({ facts: [] });

      const ctx = context({ maxChars: 1_600 });

      await stage.run(ctx);

      // One batch fits; the rest are left pending for a continuation job.
      expect(llm.json).toHaveBeenCalledTimes(1);
      expect(notes.some((note) => note.includes('character budget'))).toBe(true);
      expect(ctx.budget.charsLeft()).toBe(0);
      // p4 is never written at all — it stays exactly as it was, still pending,
      // for the continuation job to pick up.
      const touched = prisma.discoveredPage.update.mock.calls.map((call) => (call[0] as { where: { id: string } }).where.id);
      expect(touched).not.toContain('p4');
    });

    // Regression test for a defect found in a live run: the stage broke out of
    // its batch loop when the *elapsed* budget ran out, the orchestrator then
    // checkpointed EXTRACT as the last completed stage, and the continuation job
    // resumed at RECONCILE — so pages still awaiting the LLM pass were never
    // extracted at all (a real run extracted 2 of its 6 selected pages).
    // Signalling a pause instead leaves the stage uncheckpointed, so the
    // continuation re-enters it and picks up the pending pages.
    it('signals a pause, not completion, when the elapsed budget runs out mid-extraction', async () => {
      prisma.discoveredPage.findMany.mockResolvedValue([
        page({ id: 'p1', cleanedText: 'x'.repeat(400), state: { extractStatus: 'pending' } }),
      ]);

      // maxElapsedMs 0 ⇒ the per-job clock is already spent.
      await expect(stage.run(context({ maxElapsedMs: 0 }))).rejects.toThrow(RunPausedException);

      // Nothing was extracted, and nothing was marked done.
      expect(llm.json).not.toHaveBeenCalled();
      expect(prisma.discoveredPage.update).not.toHaveBeenCalled();
    });

    it('skips pages whose batch already exceeded the retry cap', async () => {
      prisma.discoveredPage.findMany.mockResolvedValue([
        page({ state: { extractStatus: 'failed', retryCount: limits.maxRetriesPerPage + 1 } }),
      ]);

      await stage.run(context());

      expect(llm.json).not.toHaveBeenCalled();
    });

    it('retries a failed page and counts the attempt', async () => {
      prisma.discoveredPage.findMany.mockResolvedValue([
        page({ state: { extractStatus: 'failed', retryCount: 1, extractError: 'previous failure' } }),
      ]);
      llm.json.mockRejectedValue(new Error('model unavailable'));

      await stage.run(context());

      const state = savedState(prisma, 'page-1')!;
      expect(state.extractStatus).toBe('failed');
      expect(state.retryCount).toBe(2);
      expect(state.extractError).toBe('model unavailable');
      expect(warnings.some((message) => message.includes('batch failed'))).toBe(true);
    });

    it('does not re-extract a page that already succeeded', async () => {
      prisma.discoveredPage.findMany.mockResolvedValue([
        page({ state: { extractStatus: 'done', facts: [{ field: 'services', value: 'Audit', sourceUrl: SERVICE_URL, excerpt: 'Audit', contentHash: '1:10' }] } }),
      ]);

      await stage.run(context());

      expect(llm.json).not.toHaveBeenCalled();
      expect(prisma.discoveredPage.update).not.toHaveBeenCalled();
    });

    it('records the model cost so the run can account for what it spent', async () => {
      prisma.discoveredPage.findMany.mockResolvedValue([page({ state: { extractStatus: 'pending' } })]);
      llmReturns({ facts: [] });

      await stage.run(context());

      expect(notes.some((note) => note.startsWith('__cost__:'))).toBe(true);
    });
  });

  it('slices page text handed to the model so one huge page cannot blow the request', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([
      page({ cleanedText: 'y'.repeat(MAX_BATCH_CHARS * 3), state: { extractStatus: 'pending' } }),
    ]);
    llmReturns({ facts: [] });

    await stage.run(context());

    const req = llm.json.mock.calls[0]![0] as { user: string };
    expect(req.user.length).toBeLessThan(MAX_BATCH_CHARS * 2);
  });
});
