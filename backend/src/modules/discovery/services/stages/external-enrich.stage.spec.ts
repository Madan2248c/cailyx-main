import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXTERNAL_ENRICHMENT_FIELDS } from '../../discovery.constants.js';
import type { ReconciledFact } from '../../discovery.types.js';
import { BoundedSearchService } from '../bounded-search.service.js';
import { LlmService } from '../../../llm/llm.service.js';
import { RunBudget, type DiscoveryRunContext } from '../pipeline-context.js';
import { ExternalEnrichStage } from './external-enrich.stage.js';

/**
 * External enrichment spends real search credits, so the tests that matter are
 * about *not* spending them: no LLM ⇒ no search, every target field already
 * filled ⇒ no search, and a two-query cap that the stage owns.
 */

describe('ExternalEnrichStage', () => {
  let stage: ExternalEnrichStage;
  let llm: { isAvailable: ReturnType<typeof vi.fn> };
  let boundedSearch: { run: ReturnType<typeof vi.fn> };

  function context(state: DiscoveryRunContext['state'] = {}): DiscoveryRunContext {
    return {
      runId: 'run-1',
      project: { id: 'project-1', name: 'Northwind Analytics', domain: 'northwind.io' },
      budget: new RunBudget(
        { pages: 0, requests: 0, chars: 0, elapsedMs: 0 },
        { maxPages: 12, maxRequests: 40, maxChars: 24_000, maxElapsedMs: 300_000, maxRetriesPerPage: 2 },
      ),
      state,
      logger: { debug: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      note: vi.fn(async () => {}),
      checkpoint: vi.fn(async () => {}),
    } as unknown as DiscoveryRunContext;
  }

  beforeEach(async () => {
    llm = { isAvailable: vi.fn().mockReturnValue(true) };
    boundedSearch = { run: vi.fn().mockResolvedValue({ facts: [], stored: 0, queriesRun: 0, costUsd: 0, pagesFetched: 0 }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ExternalEnrichStage,
        { provide: LlmService, useValue: llm },
        { provide: BoundedSearchService, useValue: boundedSearch },
      ],
    }).compile();

    stage = moduleRef.get(ExternalEnrichStage);
  });

  it('does not spend a search when no model is available to read the results', async () => {
    llm.isAvailable.mockReturnValue(false);

    await stage.run(context({ facts: [] }));

    expect(boundedSearch.run).not.toHaveBeenCalled();
  });

  it('targets only the fields first-party extraction did not find', async () => {
    await stage.run(context({ facts: [fact('headquarters', 'Boston'), fact('award', 'Best place to work')] }));

    const opts = boundedSearch.run.mock.calls[0][1] as { targetFields: string[] };
    expect(opts.targetFields).not.toContain('headquarters');
    expect(opts.targetFields).not.toContain('award');
    expect(opts.targetFields).toEqual(EXTERNAL_ENRICHMENT_FIELDS.filter((f) => f !== 'headquarters' && f !== 'award'));
  });

  it('does not search at all when every target field already has a validated fact', async () => {
    await stage.run(context({ facts: EXTERNAL_ENRICHMENT_FIELDS.map((f) => fact(f, 'value')) }));

    expect(boundedSearch.run).not.toHaveBeenCalled();
  });

  it('ignores unvalidated facts when deciding what is still missing', async () => {
    // A fact that failed validation is not evidence the field is covered.
    await stage.run(context({ facts: EXTERNAL_ENRICHMENT_FIELDS.map((f) => ({ ...fact(f, 'value'), validated: false })) }));

    const opts = boundedSearch.run.mock.calls[0][1] as { targetFields: string[] };
    expect(opts.targetFields).toEqual(EXTERNAL_ENRICHMENT_FIELDS);
  });

  it('caps itself at two searches with three results each', async () => {
    await stage.run(context({ facts: [] }));

    const opts = boundedSearch.run.mock.calls[0][1] as { queries: string[]; maxResultsPerSearch: number };
    expect(opts.queries).toHaveLength(2);
    expect(opts.maxResultsPerSearch).toBe(3);
    expect(opts.queries[0]).toContain('Northwind Analytics');
  });

  it('falls back to the domain when the project has no name', async () => {
    const ctx = context({ facts: [] });
    (ctx.project as { name: string }).name = '';

    await stage.run(ctx);

    const opts = boundedSearch.run.mock.calls[0][1] as { brand: string };
    expect(opts.brand).toBe('northwind.io');
  });

  it('appends what it found to the run’s facts', async () => {
    const found = fact('foundedYear', '1998');
    boundedSearch.run.mockResolvedValue({ facts: [found], stored: 1, queriesRun: 2, costUsd: 0.01, pagesFetched: 3 });

    const ctx = context({ facts: [fact('headquarters', 'Boston')] });
    await stage.run(ctx);

    expect(ctx.state.facts).toHaveLength(2);
    expect(ctx.state.facts?.[1]).toEqual(found);
  });

  it('never fails the run when the search pass reports nothing', async () => {
    boundedSearch.run.mockResolvedValue({ facts: [], stored: 0, queriesRun: 0, costUsd: 0, pagesFetched: 0, skipped: 'disabled' });

    const ctx = context({ facts: [] });
    await expect(stage.run(ctx)).resolves.toBeUndefined();
    expect(ctx.state.facts).toEqual([]);
  });
});

function fact(field: string, value: string): ReconciledFact {
  return {
    field,
    value,
    factType: 'explicit',
    confidence: 0.8,
    sources: [],
    sourceType: 'first_party',
    validated: true,
    validationNote: null,
  } as unknown as ReconciledFact;
}
