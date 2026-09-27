/**
 * Two-call LLM generation pipeline: propose buckets grounded in the
 * project's site context, then generate prompts per bucket. See
 * docs/analysis/query-set.md "Generation pipeline".
 *
 * Neither call is deterministic and neither is unit-tested against live
 * output — the guardrails downstream (`query-set.guardrails.ts`) are what
 * stays deterministic and testable. This service is tested with a mocked
 * `LlmService`, same pattern as Social Activity's Apify test doubles.
 *
 * @module query-set/services/query-set-generation.service
 */

import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../llm/llm.service.js';
import { FUNNEL_STAGES, PROMPT_PERSONAS } from '../query-set.types.js';
import type { BucketProposal, GeneratedPrompt, GroundingContext, PromptBranding, PromptPersona, FunnelStage } from '../query-set.types.js';

const PROPOSE_MAX_TOKENS = 2000;
const GENERATE_MAX_TOKENS = 1500;

const PROPOSE_SYSTEM = `You invent the prompt buckets an AI-answer-engine visibility audit will use for one business.

Given the business's site context (offerings, positioning, customers, geography, go-to-market, credibility, technology), propose a list of buckets — topic/angle groupings that reflect how THIS business's real buyers would actually search or ask an AI assistant about it. Do not use a generic fixed taxonomy; invent names specific to this business (e.g. "integration-partner-fit", "on-call-coverage-questions" — whatever actually matches, never a name picked from a preset list).

For each bucket, provide:
- name: a short kebab-case slug, unique in the list
- rationale: ONE sentence that names a specific fact from the site context below (an actual service, ICP trait, competitor, pain point, or outcome — quote or closely paraphrase it, don't write something generic that could apply to any business)
- persona: one of buyer | researcher | end_user | evaluator
- funnel_stage: one of problem_aware | solution_aware | product_aware | most_aware
- branding: branded | unbranded — most buckets should be unbranded (real visibility test); justify any branded one in the rationale
- target_count: how many prompts this bucket should get (your judgment of its relative weight)

Respond with ONLY JSON: {"buckets": [{"name": string, "rationale": string, "persona": string, "funnel_stage": string, "branding": string, "target_count": number}, ...]}`;

const GENERATE_SYSTEM = `You write realistic prompts a real person would type into an AI assistant (ChatGPT, Perplexity, Claude) when they are at the given funnel stage, asking about the given topic.

Rules:
- Every prompt must fit the bucket's rationale and stay in character for the funnel stage and persona given.
- Branded prompts may name the business; unbranded prompts must NOT name the business, its brand, or its domain — they test whether the business surfaces unprompted.
- Natural language a real person would type, not SEO keyword strings.
- No duplicates, no near-duplicates.

Respond with ONLY JSON: {"prompts": [{"prompt": string}, ...]} — exactly the requested count.`;

interface RawBucketsResponse {
  buckets?: unknown;
}

interface RawPromptsResponse {
  prompts?: unknown;
}

@Injectable()
export class QuerySetGenerationService {
  private readonly logger = new Logger(QuerySetGenerationService.name);

  constructor(private readonly llm: LlmService) {}

  /** LLM call #1: propose a bucket list grounded in the flattened site context. */
  async proposeBuckets(context: GroundingContext, businessSummary: string): Promise<BucketProposal[]> {
    const result = await this.llm.json<BucketProposal[]>(
      {
        system: PROPOSE_SYSTEM,
        user: `Business summary: ${businessSummary}\n\nSite context facts:\n${context.map((t) => `- ${t}`).join('\n')}`,
        maxTokens: PROPOSE_MAX_TOKENS,
        purpose: 'query-set-propose-buckets',
      },
      (raw) => validateBuckets(raw),
    );
    return result.data;
  }

  /** LLM call #2: generate `count` prompts for one bucket. */
  async generatePrompts(bucket: BucketProposal, businessSummary: string): Promise<string[]> {
    const result = await this.llm.json<string[]>(
      {
        system: GENERATE_SYSTEM,
        user: `Business summary: ${businessSummary}\n\nBucket: ${bucket.name}\nRationale: ${bucket.rationale}\nPersona: ${bucket.persona}\nFunnel stage: ${bucket.funnelStage}\nBranding: ${bucket.branding}\nCount needed: ${bucket.targetCount}`,
        maxTokens: GENERATE_MAX_TOKENS,
        purpose: `query-set-generate-prompts:${bucket.name}`,
      },
      (raw) => validatePrompts(raw),
    );
    return result.data;
  }
}

function validateBuckets(raw: unknown): BucketProposal[] {
  const arr = (raw as RawBucketsResponse)?.buckets;
  if (!Array.isArray(arr)) throw new Error('buckets missing or not an array');
  return arr
    .map((b): BucketProposal | null => {
      if (!b || typeof b !== 'object') return null;
      const o = b as Record<string, unknown>;
      const name = typeof o.name === 'string' ? o.name.trim() : '';
      const rationale = typeof o.rationale === 'string' ? o.rationale.trim() : '';
      const persona = PROMPT_PERSONAS.includes(o.persona as PromptPersona) ? (o.persona as PromptPersona) : null;
      const funnelStage = FUNNEL_STAGES.includes(o.funnel_stage as FunnelStage) ? (o.funnel_stage as FunnelStage) : null;
      const branding: PromptBranding | null = o.branding === 'branded' || o.branding === 'unbranded' ? o.branding : null;
      const targetCount = typeof o.target_count === 'number' && Number.isFinite(o.target_count) ? o.target_count : null;
      if (!name || !rationale || !persona || !funnelStage || !branding || targetCount == null) return null;
      return { name, rationale, persona, funnelStage, branding, targetCount };
    })
    .filter((b): b is BucketProposal => b !== null);
}

function validatePrompts(raw: unknown): string[] {
  const arr = (raw as RawPromptsResponse)?.prompts;
  if (!Array.isArray(arr)) throw new Error('prompts missing or not an array');
  return arr
    .map((p) => {
      if (typeof p === 'string') return p.trim();
      if (p && typeof p === 'object' && typeof (p as GeneratedPrompt).prompt === 'string') {
        return (p as GeneratedPrompt).prompt.trim();
      }
      return '';
    })
    .filter((p) => p.length > 0);
}
