import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CATEGORY_FIELDS, VALUE_JUDGEMENT_CAP } from '../../discovery.constants.js';
import type { CategorySummary, ReconciledFact } from '../../discovery.types.js';
import { LlmService } from '../../../llm/llm.service.js';
import { RunBudget, type DiscoveryRunContext } from '../pipeline-context.js';
import { ConsolidateStage } from './consolidate.stage.js';

/**
 * Consolidation is where a category's `missingFields` are decided, and that
 * list is what the completeness score is computed from — so these tests care
 * most about *when a call is spent* and *what is reported missing*, not about
 * the prose the model returns.
 */

describe('ConsolidateStage', () => {
  let stage: ConsolidateStage;
  let llm: { json: ReturnType<typeof vi.fn>; isAvailable: ReturnType<typeof vi.fn> };

  function context(state: DiscoveryRunContext['state'] = {}): DiscoveryRunContext & { notes: string[] } {
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
    } as unknown as DiscoveryRunContext & { notes: string[] };
  }

  /**
   * What the model returned, run through the real validator — `LlmService.json`
   * parses the response and hands it to the caller's validator before returning,
   * so a mock that skips the validator would not be testing the trust boundary
   * these tests exist to pin.
   */
  /** The summary call. Value judgement gets an empty verdict set unless a test says otherwise. */
  function modelSays(raw: unknown): void {
    modelReplies({ summary: raw });
  }

  /**
   * Consolidation spends two calls: one for the summary, one judging each value
   * (see `judgeValues`). Answering by `purpose` keeps each test about the one it
   * cares about.
   */
  function modelReplies(replies: { summary?: unknown; verdicts?: unknown }): void {
    llm.json.mockImplementation(async (req: unknown, validate: (value: unknown) => unknown) => {
      const purpose = (req as { purpose: string }).purpose;
      console.log('MOCK CALL purpose=', JSON.stringify(purpose));
      const raw = purpose === 'offering value verdicts' ? (replies.verdicts ?? { verdicts: [] }) : (replies.summary ?? { categories: [] });
      return { data: validate(raw), model: 'test-model', provider: 'openrouter', costUsd: 0, costIsReported: false };
    });
  }

  /** Verdicts for the values a test put in. */
  function verdicts(entries: Array<{ category: string; value: string; keep: boolean; duplicateOf?: string | null }>): void {
    modelReplies({ verdicts: { verdicts: entries.map((e) => ({ ...e, duplicateOf: e.duplicateOf ?? null })) } });
  }

  beforeEach(async () => {
    llm = { json: vi.fn(), isAvailable: vi.fn().mockReturnValue(true) };

    const moduleRef = await Test.createTestingModule({
      providers: [ConsolidateStage, { provide: LlmService, useValue: llm }],
    }).compile();

    stage = moduleRef.get(ConsolidateStage);
  });

  describe('when a call is spent', () => {
    it('spends one summary call covering every category that has validated facts', async () => {
      modelSays({ categories: [] });

      const ctx = context({ facts: [fact('services', 'Data engineering'), fact('icp', 'Mid-market teams')] });
      await stage.run(ctx);

      const summaryCalls = llm.json.mock.calls.filter((c) => (c[0] as { purpose: string }).purpose === 'category-level consolidation');
      expect(summaryCalls).toHaveLength(1);
      const request = summaryCalls[0]![0] as { user: string };
      expect(request.user).toContain('"category":"offerings"');
      expect(request.user).toContain('"category":"customers"');
      // A category with no facts is not in the payload at all.
      expect(request.user).not.toContain('"category":"credibility"');
    });

    it('pins the voice and merge rules in both prompts, so a refactor cannot silently drop them', async () => {
      modelSays({ categories: [] });

      const ctx = context({ facts: [fact('services', 'Email Builder')] });
      await stage.run(ctx);

      const calls = llm.json.mock.calls.map((c) => c[0] as { purpose: string; system: string });
      const summary = calls.find((c) => c.purpose === 'category-level consolidation');
      const judgement = calls.find((c) => c.purpose === 'offering value verdicts');
      // Summaries must read as the company, never as commentary on the evidence.
      expect(summary?.system).toContain('instead of the business is a failure');
      // Variants of one capability must merge; support/community/academy are not offerings.
      expect(judgement?.system).toContain('Merge variants of the same capability aggressively');
      expect(judgement?.system).toContain('not a purchased offering');
    });

    it('judges values in a separate call, and keeps every value it does not rule on', async () => {
      verdicts([{ category: 'offerings', value: 'Data engineering', keep: true }]);

      const ctx = context({ facts: [fact('services', 'Data engineering'), fact('services', 'Unjudged value')] });
      await stage.run(ctx);

      const judgement = llm.json.mock.calls.find((c) => (c[0] as { purpose: string }).purpose === 'offering value verdicts');
      expect(judgement).toBeDefined();
      // Fail-open: the value the model never mentioned survives.
      expect(ctx.state.summaries?.find((s) => s.category === 'offerings')?.facts).toEqual(['Data engineering', 'Unjudged value']);
    });

    it('drops values the judge rejects and the duplicates it names', async () => {
      verdicts([
        { category: 'offerings', value: 'Managed dedicated IPs', keep: true },
        { category: 'offerings', value: 'Integrate tonight', keep: false },
        { category: 'offerings', value: 'emails landing in spam', keep: true, duplicateOf: 'emails landing in spam folder instead of inbox' },
        { category: 'offerings', value: 'emails landing in spam folder instead of inbox', keep: true },
      ]);

      const ctx = context({
        facts: [
          fact('services', 'Managed dedicated IPs'),
          fact('services', 'Integrate tonight'),
          fact('services', 'emails landing in spam'),
          fact('services', 'emails landing in spam folder instead of inbox'),
        ],
      });
      await stage.run(ctx);

      expect(ctx.state.summaries?.find((s) => s.category === 'offerings')?.facts).toEqual([
        'Managed dedicated IPs',
        'emails landing in spam folder instead of inbox',
      ]);
    });

    it('ignores a verdict about a value that was never in the input', async () => {
      verdicts([{ category: 'offerings', value: 'A value nobody extracted', keep: true }]);

      const ctx = context({ facts: [fact('services', 'Data engineering')] });
      await stage.run(ctx);

      expect(ctx.state.summaries?.find((s) => s.category === 'offerings')?.facts).toEqual(['Data engineering']);
    });

    it('keeps every value when the judgement call fails', async () => {
      llm.json.mockImplementation(async (req: unknown, validate: (value: unknown) => unknown) => {
        if ((req as { purpose: string }).purpose === 'offering value verdicts') throw new Error('model unavailable');
        return { data: validate({ categories: [] }), model: 'test-model', provider: 'openrouter', costUsd: 0, costIsReported: false };
      });

      const ctx = context({ facts: [fact('services', 'Integrate tonight')] });
      await stage.run(ctx);

      expect(ctx.state.summaries?.find((s) => s.category === 'offerings')?.facts).toEqual(['Integrate tonight']);
    });

    it('collapses values that differ only in case and punctuation', async () => {
      const ctx = context({
        facts: [
          fact('technology', 'simpler APIs, better webhooks, and best-in-class debugging'),
          fact('technology', 'Simpler APIs better webhooks best in class debugging'),
        ],
      });
      await stage.run(ctx);

      expect(ctx.state.summaries?.find((s) => s.category === 'technology')?.facts).toHaveLength(1);
    });

    // Regression test for a real defect found by running the judge against a
    // real site's facts: a long category (76 unique offerings on a real crawl)
    // was truncated to one chunk, so everything past the cut was never judged
    // at all — and fail-open kept it unchanged. Over half a real offerings list
    // survived that way, marketing copy included. Every value must be judged,
    // however many chunks that takes.
    it('judges every value in a category larger than one chunk, not just the first chunk', async () => {
      const many = Array.from({ length: VALUE_JUDGEMENT_CAP + 5 }, (_, i) => `Service ${i}`);
      llm.json.mockImplementation(async (req: unknown, validate: (value: unknown) => unknown) => {
        const purpose = (req as { purpose: string; user: string }).purpose;
        if (purpose !== 'offering value verdicts') {
          return { data: validate({ categories: [] }), model: 'test-model', provider: 'openrouter', costUsd: 0, costIsReported: false };
        }
        // Reject the one value this test cares about, whichever chunk it lands in.
        const raw = { verdicts: [{ value: 'Service 42', keep: false, duplicateOf: null }] };
        return { data: validate(raw), model: 'test-model', provider: 'openrouter', costUsd: 0, costIsReported: false };
      });

      const ctx = context({ facts: many.map((v) => fact('services', v)) });
      await stage.run(ctx);

      const judgementCalls = llm.json.mock.calls.filter((c) => (c[0] as { purpose: string }).purpose === 'offering value verdicts');
      // More values than one chunk holds ⇒ more than one call.
      expect(judgementCalls.length).toBeGreaterThan(1);
      const kept = ctx.state.summaries?.find((s) => s.category === 'offerings')?.facts ?? [];
      expect(kept).not.toContain('Service 42');
      expect(kept).toHaveLength(many.length - 1);
    });

    it('spends no call at all when there are no facts', async () => {
      const ctx = context();
      await stage.run(ctx);

      expect(llm.json).not.toHaveBeenCalled();
      expect(ctx.state.summaries).toHaveLength(Object.keys(CATEGORY_FIELDS).length);
    });

    it('spends no call when no provider is configured', async () => {
      llm.isAvailable.mockReturnValue(false);
      const ctx = context({ facts: [fact('services', 'Data engineering')] });
      await stage.run(ctx);

      expect(llm.json).not.toHaveBeenCalled();
    });

    it('skips the whole stage when summaries already exist from a prior attempt', async () => {
      const existing: CategorySummary = { category: 'identity', summary: 'from a previous job', facts: [], missingFields: [], conflictNotes: [] };
      const ctx = context({ summaries: [existing] });
      await stage.run(ctx);

      expect(llm.json).not.toHaveBeenCalled();
      expect(ctx.state.summaries).toEqual([existing]);
    });
  });

  describe('what is reported missing', () => {
    it('reports every expected field of a zero-fact category as missing', async () => {
      modelSays({ categories: [] });

      const ctx = context({ facts: [fact('services', 'Data engineering')] });
      await stage.run(ctx);

      const credibility = ctx.state.summaries?.find((s) => s.category === 'credibility');
      expect(credibility?.missingFields).toEqual(CATEGORY_FIELDS.credibility);
    });

    it('takes the model’s missingFields but drops ones the category does not expect', async () => {
      modelSays({ categories: [
          {
            category: 'identity',
            summary: 'A data consultancy.',
            facts: [],
            conflicts: [],
            // `pricing` is not an identity field — keeping it would deflate a
            // score for something this category was never measured on.
            missingFields: ['foundedYear', 'pricing', 'notAField'],
            confidence: 0.5,
          },
        ] });

      const ctx = context({ facts: [fact('brand', 'Northwind Analytics')] });
      await stage.run(ctx);

      expect(ctx.state.summaries?.find((s) => s.category === 'identity')?.missingFields).toEqual(['foundedYear']);
    });

    it('drops a category the model invented', async () => {
      modelSays({ categories: [{ category: 'made_up', summary: 'x', facts: [], conflicts: [], missingFields: [], confidence: 0.5 }] });

      const ctx = context({ facts: [fact('services', 'Data engineering')] });
      await stage.run(ctx);

      expect(ctx.state.summaries?.some((s) => s.category === 'made_up')).toBe(false);
    });

    // The cleaned value list is what the profile is built from, so a value the
    // model reworded has to be refused: it could not be matched back to the fact
    // (and therefore the evidence) it came from.
    it('matches verdicts back to the input spelling, not the model’s', async () => {
      // Same value, different casing — the input's spelling is what survives, so
      // the canonical list still matches the facts (and their evidence).
      verdicts([{ category: 'offerings', value: 'DATA ENGINEERING', keep: true }]);

      const ctx = context({ facts: [fact('services', 'Data engineering'), fact('services', 'Warehouse migrations')] });
      await stage.run(ctx);

      expect(ctx.state.summaries?.find((s) => s.category === 'offerings')?.facts).toEqual(['Data engineering', 'Warehouse migrations']);
    });

    it('keeps the model’s conflict notes', async () => {
      modelSays({ categories: [
          {
            category: 'identity',
            summary: 'Two names.',
            facts: [],
            conflicts: ['legalName is both "Northwind LLC" and "Northwind Ltd"'],
            missingFields: [],
            confidence: 0.3,
          },
        ] });

      const ctx = context({ facts: [fact('legalName', 'Northwind LLC')] });
      await stage.run(ctx);

      expect(ctx.state.summaries?.find((s) => s.category === 'identity')?.conflictNotes).toEqual([
        'legalName is both "Northwind LLC" and "Northwind Ltd"',
      ]);
    });
  });

  describe('degraded paths', () => {
    it('falls back deterministically when the call throws, reporting nothing missing for categories that had facts', async () => {
      llm.json.mockRejectedValue(new Error('model unavailable'));

      const ctx = context({ facts: [fact('services', 'Data engineering')] });
      await stage.run(ctx);

      const offerings = ctx.state.summaries?.find((s) => s.category === 'offerings');
      const credibility = ctx.state.summaries?.find((s) => s.category === 'credibility');
      // The facts exist; only the prose is absent.
      expect(offerings?.missingFields).toEqual([]);
      // Nothing was found for credibility at all.
      expect(credibility?.missingFields).toEqual(CATEGORY_FIELDS.credibility);
    });

    // Regression test for a defect this suite caught: the no-provider return
    // reported every expected field of every category as missing even when facts
    // existed, so a run with no LLM configured scored 0 completeness despite a
    // successful extraction — and disagreed with the throw path above, which was
    // adapted during the port. Both paths now answer "are the fields absent?"
    // rather than "did we get to summarise?".
    it('reports nothing missing without a provider when the facts are there', async () => {
      llm.isAvailable.mockReturnValue(false);

      const ctx = context({ facts: [fact('services', 'Data engineering'), fact('icp', 'Mid-market teams')] });
      await stage.run(ctx);

      expect(ctx.state.summaries?.find((s) => s.category === 'offerings')?.missingFields).toEqual([]);
      expect(ctx.state.summaries?.find((s) => s.category === 'customers')?.missingFields).toEqual([]);
      // A category with no facts at all is still reported in full.
      expect(ctx.state.summaries?.find((s) => s.category === 'credibility')?.missingFields).toEqual(CATEGORY_FIELDS.credibility);
    });
  });

  describe('runForCategories (used by gap research)', () => {
    it('refreshes only the named categories and leaves the rest byte-identical', async () => {
      modelSays({ categories: [{ category: 'identity', summary: 'Refreshed.', facts: [], conflicts: [], missingFields: ['foundedYear'], confidence: 0.5 }] });

      const untouched: CategorySummary = { category: 'offerings', summary: 'Services list.', facts: ['Data engineering'], missingFields: [], conflictNotes: ['keep me'] };
      const stale: CategorySummary = { category: 'identity', summary: 'Old identity.', facts: ['Northwind'], missingFields: ['foundedYear', 'category'], conflictNotes: [] };

      const ctx = context({ facts: [fact('brand', 'Northwind')], summaries: [stale, untouched] });
      await stage.runForCategories(ctx, ['identity']);

      expect(ctx.state.summaries?.[0]).toMatchObject({ category: 'identity', summary: 'Refreshed.' });
      expect(ctx.state.summaries?.[1]).toEqual(untouched);
      // Only the requested category was sent.
      const request = llm.json.mock.calls[0][0] as { user: string };
      expect(request.user).toContain('"category":"identity"');
      expect(request.user).not.toContain('"category":"offerings"');
    });

    it('adds a category that had no summary yet', async () => {
      modelSays({ categories: [{ category: 'credibility', summary: 'No proof found.', facts: [], conflicts: [], missingFields: [], confidence: 0 }] });

      const ctx = context({ facts: [fact('award', 'Best place to work')], summaries: [] });
      await stage.runForCategories(ctx, ['credibility']);

      expect(ctx.state.summaries?.map((s) => s.category)).toEqual(['credibility']);
    });

    it('ignores categories it does not know', async () => {
      const ctx = context({ facts: [], summaries: [] });
      await stage.runForCategories(ctx, ['nonsense']);

      expect(llm.json).not.toHaveBeenCalled();
      expect(ctx.state.summaries).toEqual([]);
    });
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
  } as ReconciledFact;
}
