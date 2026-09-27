/**
 * Handlers for off-site and answer-engine problems: dormant/infrequent
 * social platforms (Social Activity) and prompts where AI answers name a
 * rival instead of the client (AEO Audit).
 *
 * AEO specs are keyed by the prompt text, not the observation id — the id
 * changes every audit, the prompt doesn't, so the same losing prompt on the
 * next audit updates the same spec instead of creating a new one.
 *
 * @module remediation/handlers/presence.handlers
 */

import { MAX_AEO_PROMPT_SPECS } from '../remediation.constants.js';
import type { FixSpecDraft, RemediationHandler } from '../remediation.types.js';

const PLATFORM_LABEL: Record<string, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X',
  youtube: 'YouTube',
  tiktok: 'TikTok',
};

export const socialHandler: RemediationHandler = {
  id: 'social',
  detect(snapshot) {
    const run = snapshot.socialActivity;
    if (!run) return [];
    return run.findings
      .filter((f) => f.status === 'fail' && (f.type === 'dormant-platform' || f.type === 'infrequent-platform'))
      .map((f): FixSpecDraft => {
        const label = PLATFORM_LABEL[f.platform] ?? f.platform;
        const dormant = f.type === 'dormant-platform';
        return {
          problemKey: `social.${f.type}`,
          target: `social:${f.platform}`,
          fixClass: 'OFF_SITE',
          method: 'INSTRUCTIONS',
          groupKey: 'social',
          severity: dormant ? 'MEDIUM' : 'LOW',
          effort: 'MEDIUM',
          title: dormant ? `Revive the ${label} account` : `Post on ${label} more regularly`,
          evidence: { platform: f.platform, detail: f.detail },
          sources: [{ module: 'social-activity', runId: run.runId, findingRef: `${f.platform}:${f.type}` }],
          steps: [
            f.detail,
            'AI assistants use recent, consistent activity as a signal that a company is real and current. A dormant profile linked from the site counts against it.',
            `Agree a realistic cadence with the client (e.g. one post a week on ${label}) and plan the first month of posts.`,
            dormant ? `If the client will not maintain ${label}, remove it from the site's links and structured data instead, and dismiss this fix.` : 'Re-run the social activity audit after a month to confirm.',
          ],
          acceptance: { kind: 'finding-absent', module: 'social-activity', findingRef: `${f.platform}:${f.type}` },
        };
      });
  },
};

export function promptTarget(prompt: string): string {
  return `prompt:${prompt.toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

export const aeoHandler: RemediationHandler = {
  id: 'aeo',
  detect(snapshot) {
    const run = snapshot.aeoAudit;
    if (!run) return [];
    const brand = snapshot.company?.name ?? snapshot.projectName;
    return run.losingPrompts.slice(0, MAX_AEO_PROMPT_SPECS).map(
      (p): FixSpecDraft => ({
        problemKey: 'aeo.losing-prompt',
        target: promptTarget(p.prompt),
        fixClass: 'CONTENT',
        method: 'LLM_DRAFT',
        groupKey: 'aeo-content',
        severity: 'MEDIUM',
        effort: 'MEDIUM',
        title: `Win the AI answer for "${p.prompt}"`,
        evidence: { prompt: p.prompt, losesTo: p.losesTo },
        sources: [{ module: 'aeo-audit', runId: run.runId, findingRef: `losing-prompt:${p.observationId}` }],
        steps: [
          `When asked "${p.prompt}", AI answers recommended ${p.losesTo.join(', ') || 'others'} instead of ${brand}.`,
          `Publish (or improve) one page that answers this question directly in its first paragraph, says plainly where ${brand} fits, and backs it with specifics (who it is for, what it does, proof).`,
          'Use "Draft copy" on this fix for a page brief with a suggested answer paragraph and FAQ, then review it with the client.',
          'Link to the page from the main navigation or a relevant hub page so crawlers find it.',
        ],
        acceptance: { kind: 'finding-absent', module: 'aeo-audit', findingRef: promptTarget(p.prompt) },
      }),
    );
  },
};
