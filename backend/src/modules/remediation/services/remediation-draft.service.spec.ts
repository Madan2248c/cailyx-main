import { BadRequestException, HttpException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmService } from '../../llm/llm.service.js';
import type { SourceSnapshotCollector } from '../collectors/source-snapshot.collector.js';
import { asPrisma, createRemediationPrismaMock, type RemediationPrismaMock } from '../testing/prisma.fixture.js';
import { buildGrounding, checkDraft, draftKindFor, inventedNumbers, RemediationDraftService } from './remediation-draft.service.js';

describe('draft guardrails', () => {
  it('maps problem keys to draft kinds and refuses the rest', () => {
    expect(draftKindFor('page.title-too-long')).toBe('title');
    expect(draftKindFor('page.meta-missing')).toBe('meta');
    expect(draftKindFor('aeo.losing-prompt')).toBe('answer-page');
    expect(draftKindFor('robots.missing')).toBeNull();
  });

  it('flags numbers the grounding never mentioned', () => {
    expect(inventedNumbers('Trusted by 5,000 teams since 2019', 'Acme makes widgets. Founded 2019.')).toEqual(['5000']);
    expect(inventedNumbers('Plans from $29', 'Pricing: $29 per month')).toEqual([]);
  });

  it('rejects a title outside the SEO band', () => {
    expect(checkDraft('title', { title: 'Too short' }, 'x')[0]).toMatch(/outside 30-60/);
    expect(checkDraft('title', { title: 'Acme widgets for small teams, simply managed | Acme' }, 'Brand: Acme')).toEqual([]);
  });

  it('rejects an answer page with an invented statistic', () => {
    const problems = checkDraft(
      'answer-page',
      { pageTitle: 'Best widget tool', answerParagraph: 'Acme is used by 80% of teams.', outline: ['Why'], faq: [{ question: 'Q?', answer: 'A.' }] },
      'Brand: Acme',
    );
    expect(problems.join(' ')).toMatch(/80/);
  });

  it('grounding for an answer page carries the question and rivals, nothing else invented', () => {
    const g = buildGrounding('answer-page', { prompt: 'Best widget tool?', losesTo: ['Globex'] }, 'prompt:x', null, 'Acme');
    expect(g).toBe('Brand: Acme\nBuyer question: Best widget tool?\nAI answers currently recommend instead: Globex');
  });
});

describe('RemediationDraftService', () => {
  let prisma: RemediationPrismaMock;
  let llm: { isAvailable: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  let service: RemediationDraftService;

  const metaFix = { id: 'fix-1', projectId: 'project-1', problemKey: 'page.meta-missing', target: 'https://acme.test/pricing', evidence: { currentTitle: 'Pricing' }, project: { id: 'project-1', clientId: 'client-1', name: 'Acme', domain: 'acme.test' } };

  beforeEach(() => {
    prisma = createRemediationPrismaMock();
    llm = { isAvailable: vi.fn().mockReturnValue(true), json: vi.fn() };
    const collector = { companyFacts: vi.fn().mockResolvedValue({ name: 'Acme', url: 'https://acme.test', description: 'Acme makes widgets for small teams.', logoUrl: null, sameAs: [], offerings: [] }) };
    const config = { get: vi.fn((_k: string, d: string) => d) };
    service = new RemediationDraftService(asPrisma(prisma), llm as unknown as LlmService, collector as unknown as SourceSnapshotCollector, config as unknown as ConfigService);
    prisma.fixSpec.findFirst.mockResolvedValue(metaFix);
    prisma.fixSpecEvent.count.mockResolvedValue(0);
    prisma.fixSpec.update.mockImplementation(async (a: { data: unknown }) => a.data);
  });

  it('stores a draft that passes the guardrails, with model and cost, as an event', async () => {
    llm.json.mockResolvedValue({ data: { metaDescription: 'Simple pricing for Acme widgets: see plans for small teams and pick the one that fits how you work.' }, model: 'm', costUsd: 0.001 });
    const out = (await service.draft('client-1', 'fix-1', 'user-1')) as any;
    expect(out.llmDraft).toMatchObject({ kind: 'meta', model: 'm', costUsd: 0.001 });
    expect(out.events.create).toMatchObject({ kind: 'draft', actor: 'user-1' });
  });

  it('422s a draft that fails the guardrails and stores nothing', async () => {
    llm.json.mockResolvedValue({ data: { metaDescription: 'Too short.' }, model: 'm', costUsd: 0 });
    await expect(service.draft('client-1', 'fix-1', 'u')).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.fixSpec.update).not.toHaveBeenCalled();
  });

  it('refuses fixes that have no copy to draft', async () => {
    prisma.fixSpec.findFirst.mockResolvedValue({ ...metaFix, problemKey: 'robots.missing' });
    await expect(service.draft('client-1', 'fix-1', 'u')).rejects.toBeInstanceOf(BadRequestException);
    expect(llm.json).not.toHaveBeenCalled();
  });

  it('503s without an LLM provider', async () => {
    llm.isAvailable.mockReturnValue(false);
    await expect(service.draft('client-1', 'fix-1', 'u')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('429s once the per-project daily cap is reached, before any LLM call', async () => {
    prisma.fixSpecEvent.count.mockResolvedValue(20);
    await expect(service.draft('client-1', 'fix-1', 'u')).rejects.toBeInstanceOf(HttpException);
    expect(llm.json).not.toHaveBeenCalled();
  });
});
