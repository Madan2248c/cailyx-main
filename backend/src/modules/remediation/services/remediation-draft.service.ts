/**
 * LLM copy drafts — the only place this module calls an LLM, and only when
 * an operator asks for one on a single fix (`POST …/fixes/:id/draft`).
 *
 * Three draft kinds, picked from the fix's problem key:
 *   - `page.title-*` → a rewritten `<title>`
 *   - `page.meta-*`  → a rewritten meta description
 *   - `aeo.losing-prompt` → an answer-page brief (title, answer paragraph,
 *     outline, FAQ)
 *
 * Guardrails (code, not prompt): the output must fit the SEO length bands,
 * and no number may appear in it unless the same number appears in the
 * grounding text the model was given — a draft never invents a statistic,
 * price or year. A per-project cap bounds spend. Drafts are proposals: they
 * are stored on the fix (`llmDraft`), never published anywhere, and a re-sync
 * never overwrites them.
 *
 * @module remediation/services/remediation-draft.service
 */

import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { LlmService } from '../../llm/llm.service.js';
import { SEO_BANDS } from '../../technical-audit/technical-audit.constants.js';
import { SourceSnapshotCollector } from '../collectors/source-snapshot.collector.js';
import { DEFAULT_MAX_DRAFTS_PER_DAY, DRAFT_MAX_TOKENS } from '../remediation.constants.js';
import { text } from '../handlers/common.js';
import type { CompanyFacts } from '../remediation.types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
function asJson(value: unknown): any {
  return JSON.parse(JSON.stringify(value ?? null)) as any;
}

export type DraftKind = 'title' | 'meta' | 'answer-page';

export interface TitleDraft {
  title: string;
}
export interface MetaDraft {
  metaDescription: string;
}
export interface AnswerPageDraft {
  pageTitle: string;
  answerParagraph: string;
  outline: string[];
  faq: Array<{ question: string; answer: string }>;
}
export type DraftContent = TitleDraft | MetaDraft | AnswerPageDraft;

export function draftKindFor(problemKey: string): DraftKind | null {
  if (problemKey.startsWith('page.title-')) return 'title';
  if (problemKey.startsWith('page.meta-')) return 'meta';
  if (problemKey === 'aeo.losing-prompt') return 'answer-page';
  return null;
}

/** Every number-like token in a text (years, prices, percentages, counts). */
export function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ''));
}

/** Numbers in the draft that the grounding text never mentioned. */
export function inventedNumbers(draftText: string, grounding: string): string[] {
  const allowed = new Set(numbersIn(grounding));
  return [...new Set(numbersIn(draftText))].filter((n) => !allowed.has(n));
}

const RULES = [
  'Use ONLY facts present in the provided context. Do not invent statistics, prices, years, customer names, awards or claims.',
  'Do not include any number that is not already in the context.',
  'Plain, specific, non-hype language. No superlatives like "best" or "leading" unless the context says so.',
  'Never use em dashes or en dashes; use commas, colons or full stops instead.',
  'Return ONLY a JSON object of the exact shape requested.',
].join('\n');

@Injectable()
export class RemediationDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly collector: SourceSnapshotCollector,
    private readonly config: ConfigService,
  ) {}

  async draft(clientId: string, fixId: string, actorId: string) {
    const fix = await this.prisma.fixSpec.findFirst({
      where: { id: fixId, project: { clientId, deletedAt: null } },
      include: { project: true },
    });
    if (!fix) throw new NotFoundException('Fix not found.');
    const kind = draftKindFor(fix.problemKey);
    if (!kind) throw new BadRequestException('This fix has no copy to draft. It is fixed with code, config or off-site work.');
    if (!this.llm.isAvailable()) throw new ServiceUnavailableException('No LLM provider is configured.');

    const cap = Number(this.config.get<string>('REMEDIATION_MAX_DRAFTS_PER_DAY', String(DEFAULT_MAX_DRAFTS_PER_DAY)));
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const used = await this.prisma.fixSpecEvent.count({ where: { kind: 'draft', createdAt: { gte: since }, fixSpec: { projectId: fix.projectId } } });
    if (used >= cap) throw new HttpException(`Draft limit reached for this project (${cap} per 24h).`, HttpStatus.TOO_MANY_REQUESTS);

    const company = await this.collector.companyFacts(fix.project);
    const grounding = buildGrounding(kind, fix.evidence as Record<string, unknown>, fix.target, company, fix.project.name);
    const request = buildRequest(kind);

    const result = await this.llm.json<DraftContent>(
      { system: request.system, user: grounding, maxTokens: DRAFT_MAX_TOKENS, purpose: `remediation-draft-${kind}` },
      (raw) => validateShape(kind, raw),
    );

    const problems = checkDraft(kind, result.data, grounding);
    if (problems.length > 0) {
      throw new UnprocessableEntityException(`Draft rejected by guardrails: ${problems.join(' ')} Try again. Drafting is not deterministic.`);
    }

    const llmDraft = { kind, content: result.data, model: result.model, costUsd: result.costUsd, createdAt: new Date().toISOString() };
    return this.prisma.fixSpec.update({
      where: { id: fix.id },
      data: {
        llmDraft: asJson(llmDraft),
        events: { create: { kind: 'draft', actor: actorId, detail: asJson({ draftKind: kind, model: result.model, costUsd: result.costUsd }) } },
      },
      include: { sources: true },
    });
  }
}

export function buildGrounding(kind: DraftKind, evidence: Record<string, unknown>, target: string, company: CompanyFacts | null, projectName: string): string {
  const lines = [`Brand: ${company?.name ?? projectName}`];
  if (company?.description) lines.push(`About the company: ${company.description}`);
  if (company?.offerings.length) lines.push(`Offerings: ${company.offerings.join('; ')}`);
  if (kind === 'answer-page') {
    lines.push(`Buyer question: ${text(evidence['prompt'])}`);
    const rivals = Array.isArray(evidence['losesTo']) ? (evidence['losesTo'] as string[]) : [];
    if (rivals.length) lines.push(`AI answers currently recommend instead: ${rivals.join(', ')}`);
  } else {
    lines.push(`Page URL: ${target}`);
    if (text(evidence['currentTitle'])) lines.push(`Current title: ${text(evidence['currentTitle'])}`);
    if (text(evidence['currentMeta'])) lines.push(`Current meta description: ${text(evidence['currentMeta'])}`);
  }
  return lines.join('\n');
}

function buildRequest(kind: DraftKind): { system: string } {
  if (kind === 'title') {
    return {
      system: `You write HTML page titles for search and AI answer engines.\n${RULES}\nWrite one title of ${SEO_BANDS.titleMin}-${SEO_BANDS.titleMax} characters describing the page, ending with " | <Brand>" when it fits.\nShape: {"title": string}`,
    };
  }
  if (kind === 'meta') {
    return {
      system: `You write meta descriptions for search and AI answer engines.\n${RULES}\nWrite one meta description of ${SEO_BANDS.metaMin}-${SEO_BANDS.metaMax} characters: a direct answer to what the page offers and who it is for.\nShape: {"metaDescription": string}`,
    };
  }
  return {
    system: [
      'You write briefs for web pages meant to be cited by AI answer engines (ChatGPT, Perplexity, Gemini) for a specific buyer question.',
      RULES,
      'Do not disparage the competitors named; state plainly where the brand fits and for whom.',
      'Shape: {"pageTitle": string, "answerParagraph": string (2-4 sentences answering the question directly and naming the brand), "outline": string[] (4-8 H2 section headings), "faq": [{"question": string, "answer": string}] (3-5 items)}',
    ].join('\n'),
  };
}

export function validateShape(kind: DraftKind, raw: unknown): DraftContent {
  if (!raw || typeof raw !== 'object') throw new Error('draft is not an object');
  const o = raw as Record<string, unknown>;
  if (kind === 'title') {
    if (typeof o['title'] !== 'string') throw new Error('missing "title"');
    return { title: o['title'].trim() };
  }
  if (kind === 'meta') {
    if (typeof o['metaDescription'] !== 'string') throw new Error('missing "metaDescription"');
    return { metaDescription: o['metaDescription'].trim() };
  }
  const outline = Array.isArray(o['outline']) ? o['outline'].filter((x): x is string => typeof x === 'string') : [];
  const faq = Array.isArray(o['faq'])
    ? o['faq']
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .filter((x) => typeof x['question'] === 'string' && typeof x['answer'] === 'string')
        .map((x) => ({ question: String(x['question']).trim(), answer: String(x['answer']).trim() }))
    : [];
  if (typeof o['pageTitle'] !== 'string' || typeof o['answerParagraph'] !== 'string') throw new Error('missing "pageTitle" or "answerParagraph"');
  return { pageTitle: o['pageTitle'].trim(), answerParagraph: o['answerParagraph'].trim(), outline, faq };
}

/** Length bands + no invented numbers. Returns human-readable problems; empty means the draft is kept. */
export function checkDraft(kind: DraftKind, draft: DraftContent, grounding: string): string[] {
  const problems: string[] = [];
  let text: string;
  if (kind === 'title') {
    const t = (draft as TitleDraft).title;
    if (t.length < SEO_BANDS.titleMin || t.length > SEO_BANDS.titleMax) problems.push(`Title is ${t.length} characters, outside ${SEO_BANDS.titleMin}-${SEO_BANDS.titleMax}.`);
    text = t;
  } else if (kind === 'meta') {
    const m = (draft as MetaDraft).metaDescription;
    if (m.length < SEO_BANDS.metaMin || m.length > SEO_BANDS.metaMax) problems.push(`Meta description is ${m.length} characters, outside ${SEO_BANDS.metaMin}-${SEO_BANDS.metaMax}.`);
    text = m;
  } else {
    const a = draft as AnswerPageDraft;
    if (!a.answerParagraph) problems.push('Empty answer paragraph.');
    if (a.faq.length === 0) problems.push('No FAQ items.');
    text = [a.pageTitle, a.answerParagraph, ...a.outline, ...a.faq.flatMap((f) => [f.question, f.answer])].join('\n');
  }
  const invented = inventedNumbers(text, grounding);
  if (invented.length > 0) problems.push(`Contains numbers not in the source facts: ${invented.join(', ')}.`);
  return problems;
}
