/**
 * Remediation guardrails — enforced in code, never left to a handler's good
 * behaviour:
 *
 * - **Grounding**: every draft must cite at least one `(module, findingRef)`
 *   that exists in the collected snapshot, from the snapshot's own run.
 *   Otherwise it is dropped — this module never invents a problem.
 * - **Artifact validity**: generated JSON-LD must parse; a generated
 *   robots.txt must, run through the real matcher, allow every bot it claims
 *   to unblock. A failing artifact is removed (the spec falls back to
 *   instructions and says why), not saved.
 * - **Shape**: a draft needs a title and at least one step.
 *
 * Plus the reconcile rule for "is this problem gone?" (`coverageOf`): a spec
 * only counts as fixed-by-a-newer-audit when that newer run actually looked
 * at the same thing — a page that wasn't crawled this time, a check that
 * errored, or a prompt that simply wasn't asked are not evidence of a fix.
 *
 * @module remediation/guardrails/remediation.guardrails
 */

import { getBotByName } from '../../fetcher/fetcher.constants.js';
import { jsonLdBody } from '../generators/markup.generator.js';
import { robotsRootVerdicts } from '../generators/robots-verdict.js';
import { promptTarget } from '../handlers/presence.handlers.js';
import type { DroppedDraft, FixSourceRef, FixSpecDraft, SourceSnapshot } from '../remediation.types.js';

/** Every `(module|runId|findingRef)` the snapshot can back up. */
export function citableRefs(snapshot: SourceSnapshot): Set<string> {
  const out = new Set<string>();
  const ta = snapshot.technicalAudit;
  if (ta) {
    for (const f of ta.findings) out.add(`technical-audit|${ta.runId}|${f.type}`);
    if (ta.pages.length > 0) out.add(`technical-audit|${ta.runId}|page-inventory`);
  }
  const sa = snapshot.socialActivity;
  if (sa) for (const f of sa.findings) out.add(`social-activity|${sa.runId}|${f.platform}:${f.type}`);
  const aeo = snapshot.aeoAudit;
  if (aeo) for (const p of aeo.losingPrompts) out.add(`aeo-audit|${aeo.runId}|losing-prompt:${p.observationId}`);
  return out;
}

function refKey(r: FixSourceRef): string {
  return `${r.module}|${r.runId}|${r.findingRef}`;
}

export interface GuardrailResult {
  kept: FixSpecDraft[];
  dropped: DroppedDraft[];
}

export async function applyGuardrails(drafts: FixSpecDraft[], snapshot: SourceSnapshot): Promise<GuardrailResult> {
  const citable = citableRefs(snapshot);
  const kept: FixSpecDraft[] = [];
  const dropped: DroppedDraft[] = [];

  for (const draft of drafts) {
    const drop = (reason: string) => dropped.push({ problemKey: draft.problemKey, target: draft.target, reason });

    if (!draft.title.trim() || draft.steps.filter((s) => s.trim()).length === 0) {
      drop('missing title or steps');
      continue;
    }
    const grounded = draft.sources.filter((s) => citable.has(refKey(s)));
    if (grounded.length === 0) {
      drop(`ungrounded: cites ${draft.sources.map(refKey).join(', ') || 'nothing'}, none of which is in the collected data`);
      continue;
    }

    const checked = await checkArtifact(draft);
    kept.push({ ...checked, sources: grounded });
  }
  return { kept, dropped };
}

/** Removes an artifact that fails its own self-check, turning the spec into instructions with the reason recorded. */
async function checkArtifact(draft: FixSpecDraft): Promise<FixSpecDraft> {
  const a = draft.artifact;
  if (!a) return draft;
  const reject = (why: string): FixSpecDraft => ({
    ...draft,
    artifact: undefined,
    method: draft.method === 'GENERATED' ? 'INSTRUCTIONS' : draft.method,
    artifactError: `Generated fix failed its self-check and was not kept: ${why}`,
  });

  if (a.kind === 'json-ld') {
    try {
      JSON.parse(jsonLdBody(a.content));
    } catch (err) {
      return reject(`JSON-LD does not parse (${(err as Error).message})`);
    }
  }

  if (a.kind === 'file' && a.path === '/robots.txt' && draft.acceptance.kind === 'robots-allows') {
    const agents = draft.acceptance.bots
      .map((name) => getBotByName(name))
      .filter((b) => !!b && b.userAgent.toLowerCase().includes(b.name.toLowerCase()))
      .map((b) => b!.userAgent);
    const verdicts = await robotsRootVerdicts(a.content, agents);
    const stillBlocked = [...verdicts.entries()].filter(([, allowed]) => !allowed);
    if (stillBlocked.length > 0) return reject(`${stillBlocked.length} bot(s) would still be blocked at "/"`);
  }

  if (a.kind === 'file' && a.path === '/robots.txt' && draft.acceptance.kind === 'robots-exists') {
    const verdicts = await robotsRootVerdicts(a.content, ['*']);
    if (verdicts.get('*') === false) return reject('the new file would block the whole site');
  }

  return draft;
}

// ─── Reconcile coverage ──────────────────────────────────────────────────────

export interface CoverageSpec {
  problemKey: string;
  target: string;
  sources: Array<{ module: string; findingRef: string }>;
}

/**
 * When the snapshot contains a run that actually re-examined what this spec
 * is about, returns that run's completion time; otherwise null.
 */
export function coverageOf(spec: CoverageSpec, snapshot: SourceSnapshot): Date | null {
  if (spec.sources.length === 0) return null;
  let at: Date | null = null;
  const take = (d: Date) => {
    at = at === null || d < at ? d : at;
  };

  for (const source of spec.sources) {
    if (source.module === 'technical-audit') {
      const ta = snapshot.technicalAudit;
      if (!ta) return null;
      if (source.findingRef === 'page-inventory') {
        const ran = ta.findings.some((f) => f.type === 'page-inventory' && (f.status === 'pass' || f.status === 'fail'));
        if (!ran) return null;
        if (spec.target !== snapshot.siteUrl && !ta.pages.some((p) => p.url === spec.target)) return null;
      } else if (!ta.findings.some((f) => f.type === source.findingRef && (f.status === 'pass' || f.status === 'fail'))) {
        return null;
      }
      take(ta.completedAt);
    } else if (source.module === 'social-activity') {
      const sa = snapshot.socialActivity;
      if (!sa) return null;
      const platform = source.findingRef.split(':')[0];
      if (!sa.findings.some((f) => f.platform === platform && (f.status === 'pass' || f.status === 'fail'))) return null;
      take(sa.completedAt);
    } else if (source.module === 'aeo-audit') {
      const aeo = snapshot.aeoAudit;
      if (!aeo) return null;
      if (!aeo.winningPrompts.some((p) => promptTarget(p) === spec.target)) return null;
      take(aeo.completedAt);
    } else {
      return null;
    }
  }
  return at;
}
