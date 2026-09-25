import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftFact, PagePipelineState } from '../../discovery.types.js';
import { PrismaService } from '../../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../../test/mocks/prisma.mock.js';
import { RunBudget, type DiscoveryRunContext } from '../pipeline-context.js';
import { ReconcileStage } from './reconcile.stage.js';

const RUN_ID = 'run-1';
const limits = { maxPages: 12, maxRequests: 40, maxChars: 24_000, maxElapsedMs: 300_000, maxRetriesPerPage: 2 };

function fact(field: DraftFact['field'], value: string, sourceUrl: string, factType: DraftFact['factType'] = 'explicit'): DraftFact {
  return { field, value, sourceUrl, excerpt: value, contentHash: '1:10', factType };
}

function page(id: string, url: string, state: PagePipelineState & { facts?: DraftFact[] }) {
  return {
    id,
    url,
    pageType: 'SERVICE' as const,
    cleanedText: 'text',
    jsonLdRaw: null,
    contentHash: '1:10',
    fetchStatus: 'FETCHED',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    pipelineState: { selected: true, ...state } as Record<string, unknown>,
  };
}

describe('ReconcileStage', () => {
  let stage: ReconcileStage;
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
      providers: [ReconcileStage, { provide: PrismaService, useValue: asPrismaService(prisma) }],
    }).compile();

    stage = moduleRef.get(ReconcileStage);
  });

  it('scores an explicit fact on an authoritative page with a corroborating source highest', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([
      page('about', 'https://acme.com/about', {
        purposeCategory: 'about',
        facts: [fact('services', 'Tax Planning', 'https://acme.com/about')],
      }),
      page('home', 'https://acme.com/', {
        purposeCategory: 'homepage',
        facts: [fact('services', 'Tax Planning', 'https://acme.com/')],
      }),
    ]);

    const ctx = context();
    await stage.run(ctx);

    const merged = ctx.state.facts ?? [];
    expect(merged).toHaveLength(1);
    // base 0.75 (explicit) + 0.10 (authoritative citing page) + 0.05 (one extra source)
    expect(merged[0]!.confidence).toBeCloseTo(0.9, 5);
    expect(merged[0]!.sources).toHaveLength(2);
  });

  it('gives no authority boost to a page type that is not authoritative', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([
      page('blog', 'https://acme.com/blog/x', {
        purposeCategory: null,
        facts: [fact('services', 'Tax Planning', 'https://acme.com/blog/x')],
      }),
    ]);

    const ctx = context();
    await stage.run(ctx);

    expect((ctx.state.facts ?? [])[0]!.confidence).toBeCloseTo(0.75, 5);
  });

  it('caps the corroboration boost after two extra sources', async () => {
    const pages = ['https://acme.com/a', 'https://acme.com/b', 'https://acme.com/c', 'https://acme.com/d'].map((url, i) =>
      page(`p${i}`, url, { purposeCategory: 'service', facts: [fact('services', 'Tax Planning', url)] }),
    );
    prisma.discoveredPage.findMany.mockResolvedValue(pages);

    const ctx = context();
    await stage.run(ctx);

    // 0.75 + 0 corroboration beyond the cap of two extra sources (2 × 0.05 = 0.10)
    expect((ctx.state.facts ?? [])[0]!.confidence).toBeCloseTo(0.85, 5);
  });

  it('marks every value of a singular field conflicted when they disagree', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([
      page('a', 'https://acme.com/a', { purposeCategory: 'home', facts: [fact('category', 'accounting software', 'https://acme.com/a')] }),
      page('b', 'https://acme.com/b', { purposeCategory: 'home', facts: [fact('category', 'wealth management', 'https://acme.com/b')] }),
    ]);

    const ctx = context();
    await stage.run(ctx);

    const merged = ctx.state.facts ?? [];
    expect(merged).toHaveLength(2);
    // Neither value silently wins: both are marked so a human can arbitrate.
    expect(merged.every((f) => f.factType === 'conflicted')).toBe(true);
    expect(notes.some((note) => note.includes('Unresolved conflict on "category"'))).toBe(true);
  });

  it('does not mark a singular field conflicted when every source agrees', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([
      page('a', 'https://acme.com/a', { purposeCategory: 'home', facts: [fact('category', 'accounting software', 'https://acme.com/a')] }),
      page('b', 'https://acme.com/b', { purposeCategory: 'home', facts: [fact('category', 'Accounting Software ', 'https://acme.com/b')] }),
    ]);

    const ctx = context();
    await stage.run(ctx);

    const merged = ctx.state.facts ?? [];
    expect(merged).toHaveLength(1);
    expect(merged[0]!.factType).toBe('explicit');
  });

  it('drops a "service" that is really a tier or a process step', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([
      page('a', 'https://acme.com/a', {
        purposeCategory: 'service',
        facts: [fact('services', 'Starter', 'https://acme.com/a'), fact('services', 'Tax Planning', 'https://acme.com/a')],
      }),
    ]);

    const ctx = context();
    await stage.run(ctx);

    const merged = ctx.state.facts ?? [];
    const tier = merged.find((f) => f.value === 'Starter')!;
    expect(tier.validated).toBe(false);
    expect(tier.validationNote).toContain('Reconcile:');
    expect(merged.find((f) => f.value === 'Tax Planning')!.validated).toBe(false); // not yet validated by stage 6
  });

  it('keeps one entry per field+value, with each page as a source', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([
      page('a', 'https://acme.com/a', {
        purposeCategory: 'service',
        facts: [fact('services', 'Tax Planning', 'https://acme.com/a'), fact('services', 'Tax Planning', 'https://acme.com/a')],
      }),
    ]);

    const ctx = context();
    await stage.run(ctx);

    const merged = ctx.state.facts ?? [];
    expect(merged).toHaveLength(1);
    // The same page citing the value twice is still one source.
    expect(merged[0]!.sources).toHaveLength(1);
  });

  it('carries an external fact through as external, never as first-party', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([
      page('a', 'https://acme.com/a', {
        purposeCategory: 'service',
        facts: [{ ...fact('headquarters', 'Leeds, GB', 'https://acme.com/a'), sourceType: 'external' as const }],
      }),
    ]);

    const ctx = context();
    await stage.run(ctx);

    expect((ctx.state.facts ?? [])[0]!.sourceType).toBe('external');
  });

  it('takes the fetch time off the page state, so a quote carries its own fetch time', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([
      page('a', 'https://acme.com/a', {
        purposeCategory: 'service',
        fetchedAt: '2026-02-02T10:00:00.000Z',
        facts: [fact('services', 'Tax Planning', 'https://acme.com/a')],
      }),
    ]);

    const ctx = context();
    await stage.run(ctx);

    expect((ctx.state.facts ?? [])[0]!.sources[0]!.fetchedAt).toBe('2026-02-02T10:00:00.000Z');
  });
});
