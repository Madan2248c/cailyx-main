import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmService } from '../../../llm/llm.service.js';
import type { FactField, ReconciledFact } from '../../discovery.types.js';
import type { DiscoveryRunContext } from '../pipeline-context.js';
import { SynthesizeStage } from './synthesize.stage.js';

/**
 * Step 20 synthesis: the model may reword, but every label must fuse
 * verbatim inputs (basedOn) and every input must be fused or dropped with
 * an allowlisted reason — enforced deterministically, so these tests drive
 * the real validator through a mocked LlmService (same pattern as the
 * consolidate spec).
 */
describe('SynthesizeStage', () => {
  let stage: SynthesizeStage;
  let llm: { json: ReturnType<typeof vi.fn>; isAvailable: ReturnType<typeof vi.fn> };

  function fact(field: FactField, value: string): ReconciledFact {
    return {
      field,
      value,
      factType: 'explicit',
      confidence: 0.9,
      sources: [],
      sourceType: 'first_party',
      validated: true,
      validationNote: null,
    };
  }

  function context(facts: ReconciledFact[]): DiscoveryRunContext {
    return {
      runId: 'run-1',
      project: { id: 'project-1', name: 'Acme', domain: 'acme.com' },
      state: { facts },
      note: vi.fn(async () => {}),
    } as unknown as DiscoveryRunContext;
  }

  function modelReplies(reply: unknown): void {
    llm.json.mockImplementation(async (req: unknown, validate: (value: unknown) => unknown) => {
      void req;
      return { data: validate(reply), model: 'test-model', provider: 'openrouter', costUsd: 0, costIsReported: false };
    });
  }

  beforeEach(async () => {
    llm = { json: vi.fn(), isAvailable: vi.fn().mockReturnValue(true) };

    const moduleRef = await Test.createTestingModule({
      providers: [SynthesizeStage, { provide: LlmService, useValue: llm }],
    }).compile();

    stage = moduleRef.get(SynthesizeStage);
  });

  it('spends no call when there is nothing validated to fuse', async () => {
    const ctx = context([]);
    await stage.run(ctx);

    expect(llm.json).not.toHaveBeenCalled();
    expect(ctx.state.synthesis ?? []).toEqual([]);
  });

  it('spends no call when no model is available — compile falls back', async () => {
    llm.isAvailable.mockReturnValue(false);
    const ctx = context([fact('services', 'Email delivery')]);
    await stage.run(ctx);

    expect(llm.json).not.toHaveBeenCalled();
    expect(ctx.state.synthesis ?? []).toEqual([]);
  });

  it('only calls groups that have inputs', async () => {
    modelReplies({ entries: [], dropped: [] });
    const ctx = context([fact('services', 'Email delivery')]);
    await stage.run(ctx);

    const purposes = llm.json.mock.calls.map((c) => (c[0] as { purpose: string }).purpose);
    expect(purposes).toEqual(['field synthesis']);
    const bodies = llm.json.mock.calls.map((c) => (c[0] as { user: string }).user);
    expect(bodies.some((b) => b.includes('offerings.services'))).toBe(true);
    expect(bodies.some((b) => b.includes('positioning.'))).toBe(false);
  });

  it('stores fused labels and drops ungrounded entries', async () => {
    modelReplies({
      entries: [
        { key: 'offerings.services', value: 'Managed email delivery', basedOn: ['Email delivery'] },
        { key: 'offerings.services', value: 'Invented platform', basedOn: ['Something never extracted'] },
      ],
      dropped: [{ value: 'Email delivery', reason: 'slogan' }],
    });
    const ctx = context([fact('services', 'Email delivery')]);
    await stage.run(ctx);

    const entry = ctx.state.synthesis?.find((s) => s.key === 'offerings.services');
    expect(entry?.items).toEqual([
      { value: 'Managed email delivery', basedOn: ['Email delivery'], status: 'supported' },
    ]);
  });

  it('keeps unmapped inputs verbatim — a bad response never empties a field', async () => {
    modelReplies({ entries: [], dropped: [] });
    const ctx = context([fact('services', 'Email delivery')]);
    await stage.run(ctx);

    const entry = ctx.state.synthesis?.find((s) => s.key === 'offerings.services');
    expect(entry?.items).toEqual([{ value: 'Email delivery', basedOn: ['Email delivery'], status: 'supported' }]);
  });

  it('treats an invalid drop reason as unmapped, not dropped', async () => {
    modelReplies({ entries: [], dropped: [{ value: 'Email delivery', reason: 'because-i-said-so' }] });
    const ctx = context([fact('services', 'Email delivery')]);
    await stage.run(ctx);

    const entry = ctx.state.synthesis?.find((s) => s.key === 'offerings.services');
    expect(entry?.items).toHaveLength(1);
    expect(entry?.dropped).toEqual([]);
  });

  it('does not synthesize twice on a re-enqueued job', async () => {
    modelReplies({ entries: [], dropped: [] });
    const ctx = context([fact('services', 'Email delivery')]);
    ctx.state.synthesis = [{ key: 'offerings.services', items: [], dropped: [] }];
    await stage.run(ctx);

    expect(llm.json).not.toHaveBeenCalled();
  });

  it('records a note and stores nothing when the call fails', async () => {
    llm.json.mockRejectedValue(new Error('model unavailable'));
    const ctx = context([fact('services', 'Email delivery')]);
    await stage.run(ctx);

    expect(ctx.state.synthesis ?? []).toEqual([]);
  });
});
