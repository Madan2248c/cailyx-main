/**
 * Cloro (cloro.dev) answer-engine surfaces — ChatGPT, Perplexity, Gemini,
 * Google AI Mode and Google AI Overview, queried through Cloro's API
 * instead of a Playwright-driven browser session. Cloro queries the
 * *consumer* products on our behalf — the same motivation as running our
 * own browser session, without the ToS exposure of automating a signed-in
 * one ourselves.
 *
 * Ported from the old repo's `measurement/adapters/cloro.adapter.ts` —
 * logic kept verbatim (it was verified against a live call there), moved
 * into this repo's module layout.
 *
 * ## API shape (verified against a live call, not just the docs)
 *
 * `POST /v1/async/task` submits one task (`{ taskType, payload }`) and
 * returns `{ task: { id, status }, credits: { creditsToCharge,
 * creditsCharged } }`. `GET /v1/async/task/{taskId}` is polled until
 * `status` is `COMPLETED` or `FAILED`; a completed task's `response` field
 * is the **flat** provider result (`{ text, sources, ... }`) — not wrapped
 * in a `result` envelope the way the sync `/v1/monitor/*` endpoints'
 * documented schema suggests.
 *
 * Google AI Overview is not its own `taskType` — it is a `GOOGLE` task with
 * `include: { aioverview: { markdown: true } }`, and the box appears at
 * `response.aioverview`. A different flag (`include.paaAioverview`) returns
 * AI-style answers to expanded "People Also Ask" questions instead — a
 * related but distinct thing.
 *
 * ## Cost
 *
 * `costUsd` is `creditsCharged * CLORO_CREDIT_USD` — a real number,
 * computed only after Cloro reports what it actually charged. Failures
 * charge 0 credits, so a thrown error never inflates a run's cost.
 *
 * @module measurement/adapters/cloro.adapter
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CLORO_BASE_URL,
  CLORO_MAX_KEY_SUFFIX,
  CLORO_POLL_INTERVAL_MS,
  CLORO_POLL_TIMEOUT_MS,
  CLORO_REQUEST_TIMEOUT_MS,
  DEFAULT_CLORO_CREDIT_USD,
} from '../measurement.constants.js';
import type { SurfaceAdapter, SurfaceAnswer } from '../measurement.types.js';

/** Typed failure reasons — recorded on the run, never worked around. */
export type CloroFailure = 'cloro-disabled' | 'cloro-budget-exceeded' | 'cloro-task-failed' | 'cloro-timeout' | 'cloro-api-error';

/** Error carrying the typed reason so a run can report *why* it stopped. */
export class CloroAdapterError extends Error {
  constructor(
    readonly reason: CloroFailure,
    readonly surface: string,
    message: string,
  ) {
    super(message);
    this.name = 'CloroAdapterError';
  }
}

/** The five Cloro-backed surfaces this adapter family provides. */
export type CloroSurface = 'cloro_chatgpt' | 'cloro_perplexity' | 'cloro_gemini' | 'cloro_ai_overview' | 'cloro_ai_mode';

/**
 * Flat per-task credit costs, for the pre-flight budget *estimate* only —
 * the real charge always comes from `creditsCharged` on the completed task.
 */
export const CLORO_BASE_CREDITS: Record<CloroSurface, number> = {
  cloro_chatgpt: 5,
  cloro_perplexity: 4,
  cloro_gemini: 4,
  cloro_ai_overview: 5,
  cloro_ai_mode: 4,
};

interface CloroTaskSummary {
  id: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
}

interface CloroTaskCredits {
  creditsToCharge: number;
  creditsCharged: number | null;
}

interface CloroCreateResponse {
  success: boolean;
  task: CloroTaskSummary;
  credits: CloroTaskCredits;
}

interface CloroStatusResponse {
  task: CloroTaskSummary;
  credits: CloroTaskCredits;
  response?: Record<string, unknown>;
}

/**
 * Thin HTTP client for Cloro's API — auth, base URL, submit/poll/credits.
 * Shared by every `CloroAdapterBase` subclass, so there is exactly one
 * place that knows Cloro's base URL and gating rule.
 */
@Injectable()
export class CloroClient {
  private readonly logger = new Logger(CloroClient.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Multi-account fallback: `CLORO_API_KEY` is tried first, then
   * `CLORO_API_KEY1`, `CLORO_API_KEY2`, ... — separate Cloro accounts, not
   * one account's rotated secrets, so exhausting one's credits doesn't stop
   * a run. Unset entries are skipped.
   */
  private keys(): string[] {
    const names = ['CLORO_API_KEY', ...Array.from({ length: CLORO_MAX_KEY_SUFFIX }, (_, i) => `CLORO_API_KEY${i + 1}`)];
    return names.map((name) => this.config.get<string>(name)).filter((k): k is string => !!k);
  }

  /** Which configured key new task submissions start from. Advances (and stays advanced) once a key is found exhausted/rejected. */
  private activeKeyIndex = 0;

  private requireKeys(): string[] {
    const keys = this.keys();
    if (keys.length === 0) {
      throw new CloroAdapterError('cloro-disabled', 'cloro', 'CLORO_API_KEY is not set — sign up at cloro.dev and add the key to run this surface.');
    }
    return keys;
  }

  private headersFor(key: string): Record<string, string> {
    return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  }

  private headers(): Record<string, string> {
    const keys = this.requireKeys();
    return this.headersFor(keys[Math.min(this.activeKeyIndex, keys.length - 1)]!);
  }

  /**
   * `GET /v1/credits` — pre-flight balance check, summed across every
   * configured key. One key failing this check counts as 0 for that key
   * rather than aborting the whole estimate.
   */
  async getRemainingCredits(): Promise<number> {
    const keys = this.requireKeys();
    const balances = await Promise.all(
      keys.map(async (key) => {
        try {
          const res = await fetch(`${CLORO_BASE_URL}/v1/credits`, { headers: this.headersFor(key) });
          if (!res.ok) return 0;
          const body = (await res.json()) as { remaining: number };
          return Number.isFinite(body.remaining) ? body.remaining : 0;
        } catch {
          return 0;
        }
      }),
    );
    return balances.reduce((sum, n) => sum + n, 0);
  }

  /**
   * In-flight Cloro tasks, and the queue waiting for a slot. Enforced here
   * so a paid tier can raise `CLORO_MAX_CONCURRENCY` without touching the
   * executor.
   */
  private inFlight = 0;
  private readonly waiting: Array<() => void> = [];

  /** `CLORO_MAX_CONCURRENCY`, default 1 — the free tier's limit. */
  private limit(): number {
    const raw = Number(this.config.get<string>('CLORO_MAX_CONCURRENCY', '1'));
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  }

  private async acquire(): Promise<void> {
    if (this.inFlight < this.limit()) {
      this.inFlight++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.inFlight++;
  }

  private release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const next = this.waiting.shift();
    if (next) next();
  }

  /** Submit one task and poll it to completion. Throws a typed `CloroAdapterError` on any failure path. */
  async runTask(surface: string, taskType: string, payload: Record<string, unknown>): Promise<CloroStatusResponse> {
    await this.acquire();
    try {
      return await this.submitAndPoll(surface, taskType, payload);
    } finally {
      this.release();
    }
  }

  private async submitAndPoll(surface: string, taskType: string, payload: Record<string, unknown>): Promise<CloroStatusResponse> {
    const started = Date.now();
    const keys = this.requireKeys();

    let createRes: Response | null = null;
    let usedKeyIndex = this.activeKeyIndex;
    let lastErr: Error | null = null;
    for (let i = Math.min(this.activeKeyIndex, keys.length - 1); i < keys.length; i++) {
      try {
        const res = await fetch(`${CLORO_BASE_URL}/v1/async/task`, {
          method: 'POST',
          headers: this.headersFor(keys[i]!),
          body: JSON.stringify({ taskType, payload }),
          signal: AbortSignal.timeout(CLORO_REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
          const body = await res.text();
          lastErr = new Error(`POST /v1/async/task returned HTTP ${res.status}: ${body.slice(0, 300)}`);
          continue; // this key is done (401/402/403) — try the next configured one
        }
        createRes = res;
        usedKeyIndex = i;
        break;
      } catch (err) {
        lastErr = new Error(`POST /v1/async/task did not respond within ${CLORO_REQUEST_TIMEOUT_MS}ms: ${(err as Error).message}`);
      }
    }
    if (!createRes) {
      throw new CloroAdapterError('cloro-api-error', surface, lastErr?.message ?? 'All configured Cloro keys failed.');
    }
    if (usedKeyIndex !== this.activeKeyIndex) {
      this.logger.warn(`Cloro: key #${this.activeKeyIndex + 1} exhausted/rejected, switched to key #${usedKeyIndex + 1}.`);
      this.activeKeyIndex = usedKeyIndex;
    }
    const activeKey = keys[usedKeyIndex]!;

    const created = (await createRes.json()) as CloroCreateResponse;
    const taskId = created.task.id;

    while (Date.now() - started < CLORO_POLL_TIMEOUT_MS) {
      await this.sleep(CLORO_POLL_INTERVAL_MS);
      let pollRes: Response;
      try {
        pollRes = await fetch(`${CLORO_BASE_URL}/v1/async/task/${taskId}`, {
          headers: this.headersFor(activeKey),
          signal: AbortSignal.timeout(CLORO_REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        throw new CloroAdapterError('cloro-api-error', surface, `GET /v1/async/task/${taskId} did not respond within ${CLORO_REQUEST_TIMEOUT_MS}ms: ${(err as Error).message}`);
      }
      if (!pollRes.ok) {
        throw new CloroAdapterError('cloro-api-error', surface, `GET /v1/async/task/${taskId} returned HTTP ${pollRes.status}`);
      }
      const status = (await pollRes.json()) as CloroStatusResponse;
      if (status.task.status === 'COMPLETED' || status.task.status === 'FAILED') {
        if (status.task.status === 'FAILED' || !status.response) {
          throw new CloroAdapterError('cloro-task-failed', surface, `Task ${taskId} failed`);
        }
        return status;
      }
    }
    throw new CloroAdapterError('cloro-timeout', surface, `Task ${taskId} did not finish within ${CLORO_POLL_TIMEOUT_MS}ms`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** One cited source, in whichever provider's response carries it. */
interface CloroSource {
  url: string;
}

/** Flat `{ text, sources }` shape shared by ChatGPT, Perplexity, Gemini and AI Mode. */
function extractFlat(response: Record<string, unknown>): { text: string; sources: CloroSource[] } {
  return {
    text: typeof response.text === 'string' ? response.text : '',
    sources: Array.isArray(response.sources) ? (response.sources as CloroSource[]) : [],
  };
}

@Injectable()
export abstract class CloroAdapterBase implements SurfaceAdapter {
  abstract readonly name: CloroSurface;
  protected abstract readonly taskType: string;

  constructor(
    protected readonly client: CloroClient,
    protected readonly config: ConfigService,
  ) {}

  protected abstract buildPayload(prompt: string, geo: string): Record<string, unknown>;
  protected abstract extractAnswer(response: Record<string, unknown>): { text: string; sources: CloroSource[] };

  async runPrompt(prompt: string, geo: string): Promise<SurfaceAnswer> {
    const started = Date.now();
    const status = await this.client.runTask(this.name, this.taskType, this.buildPayload(prompt, geo));
    const { text, sources } = this.extractAnswer(status.response!);
    const creditsCharged = status.credits.creditsCharged ?? 0;

    return {
      text,
      citations: sources.map((s) => s.url),
      costUsd: creditsCharged * (this.config.get<number>('CLORO_CREDIT_USD') ?? DEFAULT_CLORO_CREDIT_USD),
      latencyMs: Date.now() - started,
      model: this.name,
    };
  }
}

/** ChatGPT via Cloro. */
@Injectable()
export class CloroChatGptAdapter extends CloroAdapterBase {
  readonly name = 'cloro_chatgpt' as const;
  protected readonly taskType = 'CHATGPT';
  protected buildPayload(prompt: string, geo: string) {
    return { prompt, country: geo };
  }
  protected extractAnswer = extractFlat;
}

/** Perplexity via Cloro. */
@Injectable()
export class CloroPerplexityAdapter extends CloroAdapterBase {
  readonly name = 'cloro_perplexity' as const;
  protected readonly taskType = 'PERPLEXITY';
  protected buildPayload(prompt: string, geo: string) {
    return { prompt, country: geo };
  }
  protected extractAnswer = extractFlat;
}

/** Gemini via Cloro. */
@Injectable()
export class CloroGeminiAdapter extends CloroAdapterBase {
  readonly name = 'cloro_gemini' as const;
  protected readonly taskType = 'GEMINI';
  protected buildPayload(prompt: string, geo: string) {
    return { prompt, country: geo };
  }
  protected extractAnswer = extractFlat;
}

/** Google AI Mode via Cloro. */
@Injectable()
export class CloroAiModeAdapter extends CloroAdapterBase {
  readonly name = 'cloro_ai_mode' as const;
  protected readonly taskType = 'AIMODE';
  protected buildPayload(prompt: string, geo: string) {
    return { prompt, country: geo };
  }
  protected extractAnswer = extractFlat;
}

/**
 * Google's main AI Overview box via Cloro — a `GOOGLE` task, not its own
 * taskType. `include.aioverview` (not `paaAioverview`, a different
 * per-question feature) surfaces `response.aioverview`.
 */
@Injectable()
export class CloroGoogleAiOverviewAdapter extends CloroAdapterBase {
  readonly name = 'cloro_ai_overview' as const;
  protected readonly taskType = 'GOOGLE';
  protected buildPayload(prompt: string, geo: string) {
    return { query: prompt, country: geo, include: { aioverview: { markdown: false } } };
  }
  protected extractAnswer(response: Record<string, unknown>): { text: string; sources: CloroSource[] } {
    const overview = response.aioverview as { text?: string; sources?: CloroSource[] } | undefined;
    if (!overview) {
      return { text: '', sources: [] }; // no AI Overview box for this query — a real, reportable absence
    }
    return { text: overview.text ?? '', sources: Array.isArray(overview.sources) ? overview.sources : [] };
  }
}
