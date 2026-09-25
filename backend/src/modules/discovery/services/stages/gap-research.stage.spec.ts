import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GAP_RESEARCH_MAX_FIELDS, RESULTS_PER_SEARCH } from '../../discovery.constants.js';
import type { CategorySummary, FactField, ReconciledFact } from '../../discovery.types.js';
import { BoundedSearchService } from '../bounded-search.service.js';
import { LlmService } from '../llm.service.js';
import { RunBudget, type DiscoveryRunContext } from '../pipeline-context.js';
import { ConsolidateStage } from './consolidate.stage.js';
import { GapResearchStage } from './gap-research.stage.js';

/**
 * Gap research is the narrowest pass in the pipeline: it must research exactly
 * what consolidation reported missing — no more, no less — and only re-summarise
 * the categories whose own gaps it touched.
 */

describe('GapResearchStage', () => {
  let stage: GapResearchStage;
  let llm: { isAvailable: ReturnType<typeof vi.fn> };
  let boundedSearch: { run: ReturnType<typeof vi.fn> };
  let consolidate: { runForCategories: ReturnType<typeof vi.fn> };

  function context(state: DiscoveryRunContext['state'] = {}): DiscoveryRunContext & { notes: string[] } {
    const notes: string[] = [];
    return {
      runId: 'run-1',
      project: { id: 'project-1', name: 'Northwind Analytics', domain: 'northwind.io' },
      budget: new RunBudget(
        { pages: 0, requests: 0, chars: 0, elapsedMs: 0 },
        { maxPages: 12, maxRequests: 40, maxChars: 24_000, maxElapsedMs: 300_000, maxRetriesPerPage: 2 },
      ),
      state,
      logger: { debug: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      note: vi.fn(async (text: string) => {
        notes.push(text);
      }),
      checkpoint: vi.fn(async () => {}),
      notes,
    } as unknown as DiscoveryRunContext & { notes: string[] };
  }

  const summary = (category: string, missingFields: FactField[]): CategorySummary => ({
    category,
    summary: `${category} summary`,
    facts: [],
    missingFields,
    conflictNotes: [],
  });

  beforeEach(async () => {
    llm = { isAvailable: vi.fn().mockReturnValue(true) };
    boundedSearch = { run: vi.fn().mockResolvedValue({ facts: [], stored: 0, queriesRun: 0, costUsd: 0, pagesFetched: 0 }) };
    consolidate = { runForCategories: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GapResearchStage,
        { provide: LlmService, useValue: llm },
        { provide: BoundedSearchService, useValue: boundedSearch },
        { provide: ConsolidateStage, useValue: consolidate },
      ],
    }).compile();

    stage = moduleRef.get(GapResearchStage);
  });

  it('researches exactly the fields consolidation flagged, deduped', async () => {
    await stage.run(
      context({
        summaries: [
          summary('identity', ['foundedYear', 'legalName']),
          summary('credibility', ['foundedYear', 'award']),
        ],
      }),
    );

    const opts = boundedSearch.run.mock.calls[0][1] as { targetFields: string[] };
    expect(opts.targetFields.sort()).toEqual(['award', 'foundedYear', 'legalName']);
  });

  it('caps the field list', async () => {
    const many: FactField[] = ['foundedYear', 'legalName', 'award', 'certification', 'headquarters', 'officeLocation', 'languages'];
    await stage.run(context({ summaries: [summary('identity', many)] }));

    const opts = boundedSearch.run.mock.calls[0][1] as { targetFields: string[] };
    expect(opts.targetFields).toHaveLength(GAP_RESEARCH_MAX_FIELDS);
  });

  it('does not search when consolidation reported no gaps', async () => {
    const ctx = context({ summaries: [summary('identity', [])] });
    await stage.run(ctx);

    expect(boundedSearch.run).not.toHaveBeenCalled();
    expect(ctx.notes.join(' ')).toContain('no missing fields to research');
  });

  it('does not search when there are no summaries at all', async () => {
    const ctx = context({ summaries: [] });
    await stage.run(ctx);

    expect(boundedSearch.run).not.toHaveBeenCalled();
  });

  it('does not search without a model to read results', async () => {
    llm.isAvailable.mockReturnValue(false);

    await stage.run(context({ summaries: [summary('identity', ['foundedYear'])] }));

    expect(boundedSearch.run).not.toHaveBeenCalled();
  });

  it('re-summarises only the categories whose own gaps were researched', async () => {
    boundedSearch.run.mockResolvedValue({
      facts: [fact('foundedYear', '1998')],
      stored: 1,
      queriesRun: 2,
      costUsd: 0.01,
      pagesFetched: 3,
    });

    await stage.run(
      context({
        summaries: [summary('identity', ['foundedYear']), summary('credibility', ['award']), summary('technology', [])],
      }),
    );

    // `identity` asked for foundedYear — it was researched. `credibility` asked
    // for `award`, which was *also* in the target list (the union is capped, not
    // per-category), so it is refreshed too. `technology` had no gaps and must
    // not be touched.
    expect(consolidate.runForCategories).toHaveBeenCalledTimes(1);
    const [, categories] = consolidate.runForCategories.mock.calls[0] as [unknown, string[]];
    expect(categories).toContain('identity');
    expect(categories).not.toContain('technology');
  });

  it('leaves the summaries alone when nothing was found', async () => {
    await stage.run(context({ summaries: [summary('identity', ['foundedYear'])] }));

    expect(consolidate.runForCategories).not.toHaveBeenCalled();
  });

  it('appends what it found to the run’s facts', async () => {
    const found = fact('foundedYear', '1998');
    boundedSearch.run.mockResolvedValue({ facts: [found], stored: 1, queriesRun: 1, costUsd: 0, pagesFetched: 1 });

    const ctx = context({ summaries: [summary('identity', ['foundedYear'])], facts: [fact('brand', 'Northwind')] });
    await stage.run(ctx);

    expect(ctx.state.facts?.map((f) => f.value)).toEqual(['Northwind', '1998']);
  });

  it('caps itself at two searches with three results each', async () => {
    await stage.run(context({ summaries: [summary('identity', ['foundedYear'])] }));

    const opts = boundedSearch.run.mock.calls[0][1] as { queries: string[]; maxResultsPerSearch: number };
    expect(opts.queries.length).toBeLessThanOrEqual(2);
    expect(opts.maxResultsPerSearch).toBe(RESULTS_PER_SEARCH);
  });

  it('never fails the run when the search pass reports nothing', async () => {
    const ctx = context({ summaries: [summary('identity', ['foundedYear'])] });
    await expect(stage.run(ctx)).resolves.toBeUndefined();
  });
});

function fact(field: string, value: string): ReconciledFact {
  return {
    field,
    value,
    factType: 'explicit',
    confidence: 0.8,
    sources: [],
    sourceType: 'external',
    validated: true,
    validationNote: null,
  } as unknown as ReconciledFact;
}
