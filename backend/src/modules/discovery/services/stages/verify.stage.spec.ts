import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategorySummary, ReconciledFact } from '../../discovery.types.js';
import { LlmService } from '../../../llm/llm.service.js';
import { RunBudget, type DiscoveryRunContext } from '../pipeline-context.js';
import { VerifyStage } from './verify.stage.js';

/**
 * Verification is the pipeline's second opinion on its own synthesis, and its
 * defining constraint is that it may only take away. These tests are mostly
 * about that boundary: a claim the verifier invents must not appear anywhere,
 * and a verifier that cannot run must leave the synthesis exactly as it was.
 */

describe('VerifyStage', () => {
  let stage: VerifyStage;
  let llm: { json: ReturnType<typeof vi.fn>; isAvailable: ReturnType<typeof vi.fn> };

  function modelSays(raw: unknown): void {
    llm.json.mockImplementation(async (_req: unknown, validate: (value: unknown) => unknown) => ({
      data: validate(raw),
      model: 'test-model',
      provider: 'openrouter',
      costUsd: 0,
      costIsReported: false,
    }));
  }

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

  const summary = (): CategorySummary => ({
    category: 'offerings',
    summary: 'Data engineering and analytics.',
    facts: [],
    missingFields: [],
    conflictNotes: [],
  });

  beforeEach(async () => {
    llm = { json: vi.fn(), isAvailable: vi.fn().mockReturnValue(true) };

    const moduleRef = await Test.createTestingModule({
      providers: [VerifyStage, { provide: LlmService, useValue: llm }],
    }).compile();

    stage = moduleRef.get(VerifyStage);
  });

  describe('when it runs at all', () => {
    it('no-ops without summaries', async () => {
      const ctx = context({ facts: [fact('services', 'Data engineering')] });
      await stage.run(ctx);

      expect(llm.json).not.toHaveBeenCalled();
    });

    it('no-ops without facts', async () => {
      const ctx = context({ summaries: [summary()] });
      await stage.run(ctx);

      expect(llm.json).not.toHaveBeenCalled();
    });

    it('no-ops when no provider is configured, leaving the synthesis untouched', async () => {
      llm.isAvailable.mockReturnValue(false);
      const s = summary();
      const ctx = context({ summaries: [s], facts: [fact('services', 'Data engineering')] });

      await stage.run(ctx);

      expect(llm.json).not.toHaveBeenCalled();
      expect(ctx.state.summaries?.[0]).toEqual(s);
    });

    it('only asks about categories that actually produced claims', async () => {
      modelSays({ categories: [] });
      const ctx = context({
        summaries: [
          { category: 'offerings', summary: 'Services.', facts: ['Data engineering'], missingFields: [], conflictNotes: [] },
          { category: 'credibility', summary: '', facts: [], missingFields: ['award'], conflictNotes: [] },
        ],
        facts: [fact('services', 'Data engineering')],
      });

      await stage.run(ctx);

      const request = llm.json.mock.calls[0][0] as { user: string };
      expect(request.user).toContain('"category":"offerings"');
      expect(request.user).not.toContain('"category":"credibility"');
    });
  });

  describe('applying the verdict', () => {
    it('drops a claim the verifier omitted and lowers the confidence of the ones it kept', async () => {
      const kept = fact('services', 'Data engineering');
      const dropped = fact('services', 'Wealth management');
      modelSays({
        categories: [{ category: 'offerings', claims: ['Data engineering'], summary: 'Data engineering.', issues: [], confidencePenalty: 0.1 }],
      });

      const ctx = context({ summaries: [summary()], facts: [kept, dropped] });
      await stage.run(ctx);

      const facts = ctx.state.facts ?? [];
      const keptAfter = facts.find((f) => f.value === 'Data engineering');
      const droppedAfter = facts.find((f) => f.value === 'Wealth management');

      // Kept, penalised — not deleted, so the run still records what survived.
      expect(keptAfter?.validated).toBe(true);
      expect(keptAfter?.confidence).toBeCloseTo(0.7, 5);

      // Dropped: excluded by compile's `validated` filter, still visible here.
      expect(droppedAfter?.validated).toBe(false);
      expect(droppedAfter?.confidence).toBe(0);
      expect(droppedAfter?.validationNote).toContain('independent verification');
    });

    it('records the verifier’s issues as conflict notes', async () => {
      modelSays({
        categories: [
          { category: 'offerings', claims: ['Data engineering'], summary: 'Data engineering.', issues: ['claim is about a named customer'], confidencePenalty: 0 },
        ],
      });

      const ctx = context({ summaries: [summary()], facts: [fact('services', 'Data engineering')] });
      await stage.run(ctx);

      expect(ctx.state.summaries?.[0].conflictNotes).toEqual(['Verification: claim is about a named customer']);
    });

    it('never adds a claim, even one the verifier invented', async () => {
      modelSays({
        categories: [
          {
            category: 'offerings',
            // "Wealth management" is not in the evidence and must go nowhere.
            claims: ['Data engineering', 'Wealth management'],
            summary: 'Data engineering.',
            issues: [],
            confidencePenalty: 0,
          },
        ],
      });

      const ctx = context({ summaries: [summary()], facts: [fact('services', 'Data engineering')] });
      await stage.run(ctx);

      const values = (ctx.state.facts ?? []).map((f) => f.value);
      expect(values).toEqual(['Data engineering']);
      // And the count is unchanged — nothing was appended.
      expect(ctx.state.facts).toHaveLength(1);
    });

    it('clamps a nonsense penalty into [0,1] through the validator', async () => {
      modelSays({
        categories: [{ category: 'offerings', claims: ['Data engineering'], summary: 'x', issues: [], confidencePenalty: 42 }],
      });

      const ctx = context({ summaries: [summary()], facts: [fact('services', 'Data engineering', 0.8)] });
      await stage.run(ctx);

      const after = (ctx.state.facts ?? [])[0];
      expect(after.confidence).toBeGreaterThanOrEqual(0);
      expect(after.confidence).toBeLessThanOrEqual(0.8);
    });

    it('ignores a category the verifier invented', async () => {
      modelSays({
        categories: [{ category: 'nonsense', claims: [], summary: 'x', issues: ['y'], confidencePenalty: 1 }],
      });

      const s = summary();
      const ctx = context({ summaries: [s], facts: [fact('services', 'Data engineering')] });
      await stage.run(ctx);

      expect(ctx.state.summaries?.[0]).toEqual(s);
    });

    it('drops synthesized labels the verifier rejects and keeps grounded ones', async () => {
      modelSays({
        categories: [
          {
            category: 'offerings',
            claims: ['Email delivery'],
            summary: 'Email.',
            issues: [],
            confidencePenalty: 0,
            synthesis: [{ key: 'offerings.services', value: 'Managed email', keep: true, note: null }],
          },
        ],
      });

      const ctx = context({
        summaries: [summary()],
        facts: [fact('services', 'Email delivery')],
        synthesis: [
          {
            key: 'offerings.services',
            items: [
              { value: 'Managed email', basedOn: ['Email delivery'], status: 'supported' },
              { value: 'Invented suite', basedOn: ['Email delivery'], status: 'supported' },
            ],
            dropped: [],
          },
        ],
      });
      await stage.run(ctx);

      const items = ctx.state.synthesis?.[0]?.items ?? [];
      expect(items.find((i) => i.value === 'Managed email')?.status).toBe('supported');
      const dropped = items.find((i) => i.value === 'Invented suite');
      expect(dropped?.status).toBe('dropped');
      expect(dropped?.note).toContain('independent verification');
    });
  });

  describe('failure handling', () => {
    it('leaves the synthesis exactly as consolidated when the call fails', async () => {
      llm.json.mockRejectedValue(new Error('model returned HTML'));
      const s = summary();
      const f = fact('services', 'Data engineering');
      const ctx = context({ summaries: [s], facts: [f] });

      await stage.run(ctx);

      // Verification is a safety net, not a gate — a failed second opinion must
      // not cost the run its synthesis.
      expect(ctx.state.summaries?.[0]).toEqual(s);
      expect(ctx.state.facts?.[0]).toEqual(f);
    });

    it('reports the model cost as a note when it succeeds', async () => {
      modelSays({ categories: [] });
      const ctx = context({ summaries: [summary()], facts: [fact('services', 'Data engineering')] });

      await stage.run(ctx);

      expect(ctx.notes.some((n) => n.startsWith('__cost__:'))).toBe(true);
    });
  });
});

function fact(field: string, value: string, confidence = 0.8): ReconciledFact {
  return {
    field,
    value,
    factType: 'explicit',
    confidence,
    sources: [],
    sourceType: 'first_party',
    validated: true,
    validationNote: null,
  } as ReconciledFact;
}
