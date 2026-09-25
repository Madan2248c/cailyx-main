import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MAX_CACHED_TEXT, MAX_HEADINGS_PER_PAGE } from '../../discovery.constants.js';
import { PrismaService } from '../../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../../test/mocks/prisma.mock.js';
import { FetcherService } from '../../../fetcher/fetcher.service.js';
import type { RenderResult } from '../../../fetcher/fetcher.types.js';
import { RunBudget, type DiscoveryRunContext } from '../pipeline-context.js';
import { InspectStage, readPageSignals } from './inspect.stage.js';

const RUN_ID = 'run-1';
const limits = { maxPages: 12, maxRequests: 40, maxChars: 24_000, maxElapsedMs: 300_000, maxRetriesPerPage: 2 };

function renderResult(url: string, html: string, text: string, title: string): RenderResult {
  return { url, finalUrl: url, html, text, title, timing: { latencyMs: 1 }, jsDisabled: false };
}

describe('readPageSignals', () => {
  it('prefers the meta description and falls back to og:description', () => {
    const withMeta = readPageSignals(
      '<html><head><meta name="description" content="Meta wins"><meta property="og:description" content="og loses"></head><body></body></html>',
      '',
      null,
    );
    expect(withMeta.description).toBe('Meta wins');

    const withOg = readPageSignals(
      '<html><head><meta property="og:description" content="og only"></head><body></body></html>',
      '',
      null,
    );
    expect(withOg.description).toBe('og only');
  });

  it('truncates <html lang> the way the old code did and falls back to the <title>', () => {
    const signals = readPageSignals(
      '<html lang="en-US-extra"><head><title>Acme</title></head><body></body></html>',
      '',
      null,
    );
    expect(signals.language).toBe('en-US');
    expect(signals.title).toBe('Acme');
  });

  it('keeps the title the render already reported over the <title> tag', () => {
    const signals = readPageSignals('<html><head><title>Tag title</title></head><body></body></html>', '', 'Render title');
    expect(signals.title).toBe('Render title');
  });

  it('caps the headings it keeps', () => {
    const body = Array.from({ length: MAX_HEADINGS_PER_PAGE + 5 }, (_, i) => `<h2>Heading ${i}</h2>`).join('');
    const signals = readPageSignals(`<html><body>${body}</body></html>`, '', null);
    expect(signals.headings).toHaveLength(MAX_HEADINGS_PER_PAGE);
  });

  it('captures the DOM-only extraction candidates while the DOM is still here', () => {
    const signals = readPageSignals(
      `<html><body>
        <h1>We help founders grow faster</h1>
        <div class="card"><h4>Wealth Management</h4></div>
        <div class="team-member"><h2>Jordan Blake</h2></div>
      </body></html>`,
      'We help founders grow faster',
      null,
    );
    expect(signals.serviceCandidates).toEqual(['Wealth Management']);
    expect(signals.valuePropCandidates).toEqual(['We help founders grow faster']);
  });

  it('caps the stored text and keeps raw JSON-LD for the verbatim check', () => {
    const longText = 'x'.repeat(MAX_CACHED_TEXT + 500);
    const signals = readPageSignals(
      '<html><body></body><script type="application/ld+json">{"@type":"Organization","legalName":"Acme Ltd"}</script></html>',
      longText,
      null,
    );
    expect(signals.cleanedText).toHaveLength(MAX_CACHED_TEXT);
    expect(signals.jsonLdRaw).toContain('Acme Ltd');
    expect(signals.jsonLd).toHaveLength(1);
  });
});

describe('InspectStage', () => {
  let stage: InspectStage;
  let prisma: PrismaMock;
  let fetcher: { render: ReturnType<typeof vi.fn> };
  let notes: string[];
  let checkpoint: Mock<() => Promise<void>>;

  function context(overrides: { budgetOverrides?: Partial<typeof limits> } = {}): DiscoveryRunContext {
    return {
      runId: RUN_ID,
      project: { id: 'project-1', name: 'Acme', domain: 'acme.com' },
      budget: new RunBudget({ pages: 0, requests: 0, chars: 0, elapsedMs: 0 }, { ...limits, ...overrides.budgetOverrides }),
      state: {},
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      note: vi.fn(async (text: string) => {
        notes.push(text);
      }),
      checkpoint,
    };
  }

  beforeEach(async () => {
    prisma = createPrismaMock();
    prisma.discoveredPage.findMany.mockResolvedValue([]);
    prisma.discoveredPage.count.mockResolvedValue(0);
    fetcher = { render: vi.fn() };
    notes = [];
    checkpoint = vi.fn<() => Promise<void>>(async () => {});

    const moduleRef = await Test.createTestingModule({
      providers: [
        InspectStage,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: FetcherService, useValue: fetcher },
      ],
    }).compile();

    stage = moduleRef.get(InspectStage);
  });

  it('leaves a page that already has metadata alone — no second fetch', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([
      {
        id: 'page-1',
        url: 'https://acme.com/services',
        cleanedText: 'text',
        jsonLdRaw: null,
        createdAt: new Date(),
        pipelineState: { title: 'Services', headings: ['Tax Planning'] },
      },
    ]);

    await stage.run(context());

    expect(fetcher.render).not.toHaveBeenCalled();
    expect(prisma.discoveredPage.update).not.toHaveBeenCalled();
  });

  it('repairs a page whose metadata was never recorded, without clobbering stored text', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([
      {
        id: 'page-1',
        url: 'https://acme.com/services',
        cleanedText: 'already stored text',
        jsonLdRaw: null,
        createdAt: new Date(),
        pipelineState: { discoverySource: 'sitemap' },
      },
    ]);
    fetcher.render.mockResolvedValue(
      renderResult(
        'https://acme.com/services',
        '<html><body><h2>Tax Planning</h2></body></html>',
        'fresh text',
        'Services',
      ),
    );

    const ctx = context();
    await stage.run(ctx);

    expect(fetcher.render).toHaveBeenCalledTimes(1);
    const update = prisma.discoveredPage.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(update.data.cleanedText).toBe('already stored text');
    const state = update.data.pipelineState as Record<string, unknown>;
    expect(state.title).toBe('Services');
    expect(state.headings).toEqual(['Tax Planning']);
    // Keys already on the row survive the repair.
    expect(state.discoverySource).toBe('sitemap');
    expect(notes.some((note) => note.includes('repaired metadata'))).toBe(true);
    expect(ctx.budget.snapshot().requestsSpent).toBe(1);
  });

  it('reports a page it could not repair rather than silently treating it as empty', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([
      { id: 'page-1', url: 'https://acme.com/x', cleanedText: null, jsonLdRaw: null, createdAt: new Date(), pipelineState: {} },
    ]);
    fetcher.render.mockRejectedValue(new Error('timeout'));

    await stage.run(context());

    expect(prisma.discoveredPage.update).not.toHaveBeenCalled();
    expect(notes.some((note) => note.includes('no metadata to inspect'))).toBe(true);
  });

  it('does not spend a request when the budget is already gone', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([
      { id: 'page-1', url: 'https://acme.com/x', cleanedText: null, jsonLdRaw: null, createdAt: new Date(), pipelineState: {} },
    ]);

    await stage.run(context({ budgetOverrides: { maxRequests: 0 } }));

    expect(fetcher.render).not.toHaveBeenCalled();
    expect(notes.some((note) => note.includes('no metadata to inspect'))).toBe(true);
  });

  it('records the page counts the rest of the pipeline reports', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([]);
    prisma.discoveredPage.count.mockImplementation(async (args: { where?: { fetchStatus?: unknown } }) =>
      args?.where?.fetchStatus === undefined ? 7 : 5,
    );

    const ctx = context();
    await stage.run(ctx);

    expect(ctx.state.stats).toEqual({ pagesDiscovered: 7, pagesFetched: 5 });
    expect(checkpoint).toHaveBeenCalled();
  });
});
