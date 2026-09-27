/**
 * Fix pack — the exportable form of a project's fix plan. JSON is the shape an
 * agent (or a future MCP tool) consumes; Markdown is the same content for a
 * client's developer or agency. Pure functions.
 *
 * @module remediation/services/fix-pack
 */

import type { AcceptanceCheck, Artifact } from '../remediation.types.js';

export interface FixPackProject {
  id: string;
  name: string;
  domain: string;
}

export interface FixPackFixInput {
  id: string;
  problemKey: string;
  target: string;
  fixClass: string;
  method: string;
  groupKey: string;
  severity: string;
  effort: string;
  status: string;
  title: string;
  evidence: unknown;
  artifact: unknown;
  artifactError: string | null;
  steps: unknown;
  acceptance: unknown;
  llmDraft: unknown;
  needsClientDecision: boolean;
  decision: string | null;
}

export interface FixPack {
  project: FixPackProject;
  generatedAt: string;
  fixes: Array<{
    id: string;
    problemKey: string;
    target: string;
    fixClass: string;
    method: string;
    groupKey: string;
    severity: string;
    effort: string;
    status: string;
    title: string;
    evidence: unknown;
    artifact: Artifact | null;
    artifactError: string | null;
    steps: string[];
    acceptance: AcceptanceCheck;
    draft: unknown;
    awaitingClientDecision: boolean;
  }>;
}

export function toFixPackJson(project: FixPackProject, fixes: FixPackFixInput[]): FixPack {
  return {
    project: { id: project.id, name: project.name, domain: project.domain },
    generatedAt: new Date().toISOString(),
    fixes: fixes.map((f) => ({
      id: f.id,
      problemKey: f.problemKey,
      target: f.target,
      fixClass: f.fixClass,
      method: f.method,
      groupKey: f.groupKey,
      severity: f.severity,
      effort: f.effort,
      status: f.status,
      title: f.title,
      evidence: f.evidence,
      artifact: (f.artifact as Artifact | null) ?? null,
      artifactError: f.artifactError,
      steps: Array.isArray(f.steps) ? (f.steps as string[]) : [],
      acceptance: f.acceptance as AcceptanceCheck,
      draft: f.llmDraft ?? null,
      awaitingClientDecision: f.needsClientDecision && f.decision === null,
    })),
  };
}

const FENCE = '```';

export function renderFixPackMarkdown(pack: FixPack): string {
  const lines: string[] = [
    `# Fix Plan — ${pack.project.name} (${pack.project.domain})`,
    '',
    `Generated ${pack.generatedAt}. ${pack.fixes.length} fix(es), most severe first.`,
    '',
  ];
  pack.fixes.forEach((f, i) => {
    lines.push(`## ${i + 1}. ${f.title}`, '');
    lines.push(`- **Where:** ${f.target}`);
    lines.push(`- **Severity / effort:** ${f.severity.toLowerCase()} / ${f.effort.toLowerCase()}`);
    lines.push(`- **Status:** ${f.status.toLowerCase().replace(/_/g, ' ')}${f.awaitingClientDecision ? ' — needs the client\'s decision first' : ''}`);
    lines.push(`- **Done when:** ${describeAcceptance(f.acceptance)}`, '');
    lines.push('**Steps**', '');
    f.steps.forEach((s, n) => lines.push(`${n + 1}. ${s}`));
    lines.push('');
    if (f.artifact) {
      lines.push(`**Ready-made fix**${f.artifact.path ? ` — \`${f.artifact.path}\`` : ''}${f.artifact.placement ? ` (${f.artifact.placement})` : ''}`, '');
      lines.push(`${FENCE}${f.artifact.language === 'text' ? '' : f.artifact.language}`, f.artifact.content.replace(/\n$/, ''), FENCE, '');
    } else if (f.artifactError) {
      lines.push(`> ${f.artifactError}`, '');
    }
  });
  return lines.join('\n');
}

export function describeAcceptance(check: AcceptanceCheck): string {
  switch (check.kind) {
    case 'robots-exists':
      return '/robots.txt loads with HTTP 200.';
    case 'robots-allows':
      return `robots.txt allows ${check.bots.join(', ')} at "/".`;
    case 'robots-declares-sitemap':
      return 'robots.txt has a "Sitemap:" line.';
    case 'json-ld-has':
      return `${check.url} has Organization JSON-LD with ${check.fields.join(', ')}.`;
    case 'page-issue-absent':
      return `${check.url} no longer shows: ${check.issues.join(', ')}.`;
    case 'finding-absent':
      return `the next ${check.module} run no longer reports it.`;
  }
}
