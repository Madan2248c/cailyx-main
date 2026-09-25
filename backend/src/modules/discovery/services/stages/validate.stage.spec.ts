import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FactSource, ReconciledFact } from '../../discovery.types.js';
import { PrismaService } from '../../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../../test/mocks/prisma.mock.js';
import { RunBudget, type DiscoveryRunContext } from '../pipeline-context.js';
import { ValidateStage } from './validate.stage.js';

const RUN_ID = 'run-1';
const limits = { maxPages: 12, maxRequests: 40, maxChars: 24_000, maxElapsedMs: 300_000, maxRetriesPerPage: 2 };

function source(url: string, excerpt: string | null): FactSource {
  return { url, pageType: 'service', excerpt, fetchedAt: '2026-01-01T00:00:00.000Z', contentHash: '1:10' };
}

function reconciled(overrides: Partial<ReconciledFact> = {}): ReconciledFact {
  return {
    field: 'services',
    value: 'Tax Planning',
    factType: 'explicit',
    confidence: 0.75,
    sources: [source('https://acme.com/services', 'Tax Planning')],
    sourceType: 'first_party',
    validated: false,
    validationNote: null,
    ...overrides,
  };
}

function page(url: string, cleanedText: string | null, jsonLdRaw: string | null = null) {
  return {
    id: `page-${url}`,
    url,
    pageType: 'SERVICE' as const,
    cleanedText,
    jsonLdRaw,
    contentHash: '1:10',
    fetchStatus: 'FETCHED',
    createdAt: new Date(),
    pipelineState: {},
  };
}

describe('ValidateStage', () => {
  let stage: ValidateStage;
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
      providers: [ValidateStage, { provide: PrismaService, useValue: asPrismaService(prisma) }],
    }).compile();

    stage = moduleRef.get(ValidateStage);
  });

  it('accepts a quote that appears verbatim, ignoring whitespace and case', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([
      page('https://acme.com/services', 'We offer   FRACTIONAL CMO\nServices for founders.'),
    ]);
    const ctx = context();
    ctx.state.facts = [reconciled({ sources: [source('https://acme.com/services', 'Fractional CMO Services')] })];

    await stage.run(ctx);

    const fact = ctx.state.facts![0]!;
    expect(fact.validated).toBe(true);
    expect(fact.validationNote).toBeNull();
    expect(notes).toEqual([]);
  });

  it('drops a paraphrase that is not in the page, and says how many it dropped', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([
      page('https://acme.com/services', 'We offer fractional CFO services for founders.'),
    ]);
    const ctx = context();
    ctx.state.facts = [reconciled({ sources: [source('https://acme.com/services', 'Fractional CMO Services')] })];

    await stage.run(ctx);

    const fact = ctx.state.facts![0]!;
    expect(fact.validated).toBe(false);
    expect(fact.validationNote).toContain('not found verbatim');
    expect(notes.some((note) => note.includes('Validation dropped 1'))).toBe(true);
  });

  it('accepts a fact whose quote lives in the raw JSON-LD rather than the visible text', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([
      page('https://acme.com/services', 'Visible text that does not mention it.', '{"@type":"Organization","legalName":"Acme Ltd"}'),
    ]);
    const ctx = context();
    ctx.state.facts = [
      reconciled({
        field: 'legalName',
        value: 'Acme Ltd',
        sources: [source('https://acme.com/services', 'Acme Ltd')],
      }),
    ];

    await stage.run(ctx);

    expect(ctx.state.facts![0]!.validated).toBe(true);
  });

  it('survives on any one of several citing pages', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([
      page('https://acme.com/a', 'Nothing relevant here at all.'),
      page('https://acme.com/b', 'Tax Planning and advisory for founders.'),
    ]);
    const ctx = context();
    ctx.state.facts = [
      reconciled({ sources: [source('https://acme.com/a', 'Tax Planning'), source('https://acme.com/b', 'Tax Planning')] }),
    ];

    await stage.run(ctx);

    expect(ctx.state.facts![0]!.validated).toBe(true);
  });

  it('distinguishes "no text to check against" from "the quote is not there"', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([]);
    const ctx = context();
    ctx.state.facts = [reconciled({ sources: [source('https://acme.com/gone', 'Tax Planning')] })];

    await stage.run(ctx);

    // A fetch problem, not a model that paraphrased — the note has to say which.
    expect(ctx.state.facts![0]!.validationNote).toContain('No cached text');
  });

  it('leaves a fact reconcile already excluded alone', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([page('https://acme.com/services', 'unrelated text')]);
    const ctx = context();
    ctx.state.facts = [
      reconciled({
        value: 'Starter',
        sources: [source('https://acme.com/services', 'Starter')],
        validated: false,
        validationNote: 'Reconcile: reads as a pricing tier/process step/nav label, not an offering.',
      }),
    ];

    await stage.run(ctx);

    expect(ctx.state.facts![0]!.validationNote).toContain('Reconcile:');
    expect(notes).toEqual([]);
  });

  it('falls back to the value itself when a fact has no excerpt', async () => {
    prisma.discoveredPage.findMany.mockResolvedValue([page('https://acme.com/services', 'We do Tax Planning well.')]);
    const ctx = context();
    ctx.state.facts = [reconciled({ sources: [source('https://acme.com/services', null)] })];

    await stage.run(ctx);

    expect(ctx.state.facts![0]!.validated).toBe(true);
  });

  it('does nothing when there are no facts to check', async () => {
    const ctx = context();
    ctx.state.facts = [];

    await stage.run(ctx);

    expect(prisma.discoveredPage.findMany).not.toHaveBeenCalled();
  });
});
