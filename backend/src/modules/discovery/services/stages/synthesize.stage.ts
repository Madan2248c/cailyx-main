/**
 * Step 20 synthesis (Call F in the reference workflow) — the understanding
 * pass. Consolidate judges verbatim values; this stage reads the verified
 * facts the way a careful human analyst would — what the business sells,
 * who pays, why they win — and writes each target field in plain buyer
 * language. Site copy is raw material, never output.
 *
 * The trust contract that makes rewording safe (enforced deterministically
 * in `validateSynthesis`, not left to the model):
 * - every entry fuses ≥1 verbatim input (`basedOn`), matched case-insensitively;
 * - every input is either fused or dropped with an allowlisted reason;
 *   unmapped inputs survive verbatim (fail-open, current behavior);
 * - entries never outnumber inputs (no entity multiplication).
 *
 * Runs after gap research (final facts) and before verification, which
 * checks the synthesized labels against their cited evidence.
 *
 * @module discovery/services/stages/synthesize.stage
 */

import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../../llm/llm.service.js';
import type { FactField } from '../../discovery.types.js';
import type { FieldSynthesis, SynthesizedItem } from '../../discovery.types.js';
import type { DiscoveryRunContext } from '../pipeline-context.js';
import type { ReconciledFact } from '../../discovery.types.js';

/** Profile path → the fact fields fused into it. */
const SYNTHESIS_FIELDS: Record<string, FactField[]> = {
  'descriptions.one_line': ['category'],
  'descriptions.short': ['description'],
  'descriptions.detailed': ['description'],
  'offerings.services': ['services'],
  'positioning.value_propositions': ['valueProps'],
  'positioning.differentiators': ['differentiator'],
  'positioning.problems_solved': ['painPoints'],
  'positioning.outcomes_promised': ['outcomes'],
  'customers.icp_summary': ['icp'],
};

/** One LLM call per group — small, single-subject prompts are what the model judges well. */
const SYNTHESIS_GROUPS: string[][] = [
  ['descriptions.one_line', 'descriptions.short', 'descriptions.detailed'],
  ['offerings.services'],
  [
    'positioning.value_propositions',
    'positioning.differentiators',
    'positioning.problems_solved',
    'positioning.outcomes_promised',
  ],
  ['customers.icp_summary'],
];

const DROP_REASONS = new Set([
  'cta',
  'slogan',
  'microcopy',
  'section-heading',
  'price-line',
  'testimonial',
  'not-a-value',
  'auxiliary',
]);

const MAX_VALUE_CHARS = 500;

interface RawEntry {
  key: unknown;
  value: unknown;
  basedOn: unknown;
}

interface RawDropped {
  value: unknown;
  reason: unknown;
}

/** Verbatim-input matching shared by verify (evidence lookup) and compile (assembly). */
export function matchSynthesisFacts(facts: ReconciledFact[], basedOn: string[]): ReconciledFact[] {
  const wanted = new Set(basedOn.map((b) => b.trim().toLowerCase()));
  const seen = new Set<string>();
  const out: ReconciledFact[] = [];
  for (const fact of facts) {
    const key = fact.value.trim().toLowerCase();
    if (!key || !wanted.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(fact);
  }
  return out;
}

@Injectable()
export class SynthesizeStage {
  private readonly logger = new Logger(SynthesizeStage.name);

  constructor(private readonly llm: LlmService) {}

  async run(ctx: DiscoveryRunContext): Promise<void> {
    if ((ctx.state.synthesis ?? []).length > 0) return; // already synthesized on a prior attempt
    const facts = (ctx.state.facts ?? []).filter((f) => f.validated);
    if (facts.length === 0 || !this.llm.isAvailable()) return; // nothing to fuse, or no model — compile falls back

    const byField = new Map<FactField, ReconciledFact[]>();
    for (const fact of facts) {
      const list = byField.get(fact.field) ?? [];
      list.push(fact);
      byField.set(fact.field, list);
    }

    const synthesis: FieldSynthesis[] = [];
    for (const keys of SYNTHESIS_GROUPS) {
      const inputs = new Map<string, ReconciledFact[]>();
      for (const key of keys) {
        const group = (SYNTHESIS_FIELDS[key] ?? []).flatMap((field) => byField.get(field) ?? []);
        if (group.length > 0) inputs.set(key, group);
      }
      if (inputs.size === 0) continue; // no call spent when a group has nothing to fuse
      try {
        synthesis.push(...await this.synthesizeGroup(ctx, keys, inputs));
      } catch (err) {
        this.logger.warn(
          `Field synthesis failed for [${keys.join(', ')}] on run ${ctx.runId}: ${(err as Error).message} — those fields fall back to verbatim assembly.`,
        );
        await ctx.note(`Synthesis could not run for ${keys.join(', ')} — those fields keep their extracted wording this run.`);
      }
    }
    ctx.state.synthesis = synthesis;
  }

  private async synthesizeGroup(
    ctx: DiscoveryRunContext,
    keys: string[],
    inputs: Map<string, ReconciledFact[]>,
  ): Promise<FieldSynthesis[]> {
    const snapshot = this.businessSnapshot(ctx);
    const fields: Record<string, string[]> = {};
    for (const [key, facts] of inputs) {
      fields[key] = facts.map((f) => f.value);
    }

    const result = await this.llm.json(
      {
        purpose: 'field synthesis',
        maxTokens: 2500,
        system:
          'You are a business analyst writing a company profile from researched facts. Read ALL the inputs until ' +
          'you understand the business the way a careful human would — what it sells, who pays, why they win — ' +
          'then write each requested field in plain buyer language: your own clear words, never site copy pasted ' +
          'verbatim. Microcopy, slogans and nav labels are raw material, never output.\n' +
          'Rules:\n' +
          '- Every entry MUST fuse at least one input value: list those inputs verbatim in basedOn.\n' +
          '- Never introduce a company, product, place, person or number not present in the inputs.\n' +
          '- Merge variants of the same thing into one entry; drop what is not a value of the field with a reason ' +
          '(cta, slogan, microcopy, section-heading, price-line, testimonial, not-a-value, auxiliary).\n' +
          '- descriptions.one_line follows "[Company] is a [category] that helps [ICP] achieve [outcome] through ' +
          '[main product/service]" using only supported elements; omit the slot when it cannot be grounded.\n' +
          'Respond with ONLY JSON: {"entries":[{"key":string,"value":string,"basedOn":string[]}],' +
          `"dropped":[{"value":string,"reason":string}]} — key is one of: ${keys.join(', ')}.`,
        user:
          `Business: ${snapshot}\n\n` +
          `Fields and their verified input values:\n${JSON.stringify(fields)}`,
      },
      (raw) => this.validateSynthesis(raw, keys, inputs),
    );
    return result.data;
  }

  /** Business snapshot for cross-field understanding — small, derived, never invented. */
  private businessSnapshot(ctx: DiscoveryRunContext): string {
    const facts = (ctx.state.facts ?? []).filter((f) => f.validated);
    const first = (field: FactField): string | null => facts.find((f) => f.field === field)?.value ?? null;
    const summary = (ctx.state.summaries ?? []).find((s) => s.category === 'descriptions')?.summary ?? '';
    const parts = [`name: ${ctx.project.name}`];
    const category = first('category');
    if (category) parts.push(`category: ${category}`);
    const icp = first('icp');
    if (icp) parts.push(`ICP: ${icp.slice(0, 200)}`);
    if (summary.trim()) parts.push(`positioning in their words: ${summary.trim().slice(0, 300)}`);
    return parts.join('; ');
  }

  /**
   * Trust boundary for the synthesis call. basedOn entries that are not
   * verbatim inputs are dropped with the entry; inputs neither fused nor
   * validly dropped survive verbatim (fail-open — a bad response must never
   * empty a field); entries never outnumber inputs.
   */
  private validateSynthesis(
    raw: unknown,
    keys: string[],
    inputs: Map<string, ReconciledFact[]>,
  ): FieldSynthesis[] {
    const obj = (raw ?? {}) as { entries?: unknown; dropped?: unknown };
    const entries = Array.isArray(obj.entries) ? (obj.entries as RawEntry[]) : [];
    const dropped = Array.isArray(obj.dropped) ? (obj.dropped as RawDropped[]) : [];

    const inputValues = new Map<string, { key: string; value: string }>();
    for (const [key, facts] of inputs) {
      for (const fact of facts) {
        inputValues.set(fact.value.trim().toLowerCase(), { key, value: fact.value });
      }
    }

    const byKey = new Map<string, SynthesizedItem[]>();
    const fused = new Set<string>();
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const key = typeof entry.key === 'string' ? entry.key : '';
      const value = typeof entry.value === 'string' ? entry.value.trim().slice(0, MAX_VALUE_CHARS) : '';
      const basedOn = Array.isArray(entry.basedOn)
        ? entry.basedOn.filter((b): b is string => typeof b === 'string').map((b) => b.trim()).filter(Boolean)
        : [];
      if (!keys.includes(key) || !value || basedOn.length === 0) continue;
      const grounded = basedOn.filter((b) => inputValues.has(b.toLowerCase()));
      if (grounded.length === 0) continue;
      for (const b of grounded) fused.add(b.toLowerCase());
      const list = byKey.get(key) ?? [];
      list.push({ value, basedOn: grounded, status: 'supported' });
      byKey.set(key, list);
    }

    const droppedByValue = new Map<string, string>();
    for (const d of dropped) {
      if (!d || typeof d !== 'object') continue;
      const value = typeof d.value === 'string' ? d.value.trim() : '';
      const reason = typeof d.reason === 'string' ? d.reason : '';
      if (value && DROP_REASONS.has(reason) && inputValues.has(value.toLowerCase())) {
        droppedByValue.set(value.toLowerCase(), reason);
      }
    }

    // Fail-open: an input neither fused nor validly dropped survives verbatim.
    const verbatim: Array<{ key: string; value: string }> = [];
    for (const [lower, ref] of inputValues) {
      if (!fused.has(lower) && !droppedByValue.has(lower)) verbatim.push(ref);
    }

    const out: FieldSynthesis[] = [];
    for (const key of keys) {
      const bound = inputs.get(key)?.length ?? 1;
      const items = (byKey.get(key) ?? []).slice(0, Math.max(bound, 1));
      for (const v of verbatim.filter((r) => r.key === key)) {
        items.push({ value: v.value, basedOn: [v.value], status: 'supported' });
      }
      const droppedForKey = [...droppedByValue]
        .filter(([lower]) => inputValues.get(lower)?.key === key)
        .map(([lower, reason]) => ({ value: inputValues.get(lower)!.value, reason }));
      if (items.length > 0 || droppedForKey.length > 0) {
        out.push({ key, items, dropped: droppedForKey });
      }
    }
    return out;
  }
}
