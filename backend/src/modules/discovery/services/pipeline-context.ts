/**
 * The contract between the orchestrator and the pipeline's stages.
 *
 * Every stage receives a {@link DiscoveryRunContext} and does three things with
 * it: spends budget, reads/writes its own rows through Prisma, and writes its
 * result into `ctx.state` (the run's persisted `pipeline_state`). Nothing else
 * crosses the boundary — that keeps a stage independently testable against a
 * fixed context, and keeps the orchestrator from having to know what any stage
 * actually did.
 *
 * Budgets are enforced here rather than in each stage so a stage cannot forget
 * one: `budgetLeft()` covers pages **and** requests **and** the elapsed clock,
 * which is exactly the compound condition the old code's `budgetLeft()` used.
 */

import type { Logger } from '@nestjs/common';
import type { RunPipelineState } from '../discovery.types.js';

/** What a stage needs to know about the project it is profiling. */
export interface DiscoveryProjectRef {
  id: string;
  name: string;
  /** Normalized: no protocol, no `www.`, no path. */
  domain: string;
}

export interface BudgetLimits {
  maxPages: number;
  maxRequests: number;
  maxChars: number;
  maxElapsedMs: number;
  maxRetriesPerPage: number;
}

/**
 * One job's budget. A run's counters survive across job re-enqueues (they live
 * on the run row), but the **elapsed clock restarts each job** — the budget is
 * "how long may one worker invocation run", not "how long may the run take
 * overall". That is what lets a long pipeline finish across many jobs without
 * any single one holding a worker slot for hours.
 */
export class RunBudget {
  private pages: number;
  private requests: number;
  private chars: number;
  /** Counters as they stood at the start of this job, for reporting total run elapsed. */
  private readonly carriedMs: number;
  private readonly jobStartedAt = Date.now();
  /** Copied, not held by reference: a caller reusing one limits object would otherwise silently reconfigure every budget built from it. */
  readonly limits: BudgetLimits;

  constructor(
    spent: { pages: number; requests: number; chars: number; elapsedMs: number },
    limits: BudgetLimits,
  ) {
    this.limits = { ...limits };
    this.pages = spent.pages;
    this.requests = spent.requests;
    this.chars = spent.chars;
    this.carriedMs = spent.elapsedMs;
  }

  pagesLeft(): number {
    return Math.max(0, this.limits.maxPages - this.pages);
  }

  requestsLeft(): number {
    return Math.max(0, this.limits.maxRequests - this.requests);
  }

  charsLeft(): number {
    return Math.max(0, this.limits.maxChars - this.chars);
  }

  /** Total run elapsed: time carried from prior jobs plus this job's so far. */
  elapsedMs(): number {
    return this.carriedMs + (Date.now() - this.jobStartedAt);
  }

  /** This job only — the clock the per-job ceiling is measured against. */
  jobElapsedMs(): number {
    return Date.now() - this.jobStartedAt;
  }

  deadlineReached(): boolean {
    return this.jobElapsedMs() >= this.limits.maxElapsedMs;
  }

  /** The compound gate: any one budget exhausted stops crawl work. */
  budgetLeft(): boolean {
    return this.pagesLeft() > 0 && this.requestsLeft() > 0 && !this.deadlineReached();
  }

  spendPages(n = 1): void {
    this.pages += n;
  }

  spendRequests(n = 1): void {
    this.requests += n;
  }

  spendChars(n: number): void {
    this.chars += n;
  }

  /** Counters to persist on the run row at a checkpoint. */
  snapshot(): { pagesSpent: number; requestsSpent: number; charsSpent: number; elapsedMs: number } {
    return {
      pagesSpent: this.pages,
      requestsSpent: this.requests,
      charsSpent: this.chars,
      elapsedMs: this.elapsedMs(),
    };
  }
}

/**
 * Everything a stage is given. `state` is the run's live working set — mutate it
 * freely; the orchestrator persists it after the stage returns (and on any
 * `ctx.checkpoint()` a long stage makes for itself).
 */
export interface DiscoveryRunContext {
  readonly runId: string;
  readonly project: DiscoveryProjectRef;
  readonly budget: RunBudget;
  readonly state: RunPipelineState;
  readonly logger: Logger;
  /** Append a note to the run (persisted immediately — notes survive a crash mid-stage). */
  note(text: string): Promise<void>;
  /** Persist counters + `pipeline_state` now, without ending the stage. */
  checkpoint(): Promise<void>;
}

/**
 * Raised when the elapsed-time budget runs out inside a stage that cannot
 * simply stop mid-way — the orchestrator catches it, checkpoints, and enqueues
 * the continuation job. Ported from the old code's
 * `SiteContextRunPausedException`, minus the caller-facing `resume()` it needed
 * there (the queue owns that now — see docs/analysis/discovery.md "Job
 * orchestration").
 */
export class RunPausedException extends Error {
  constructor(readonly stage: string) {
    super(`Discovery run paused: the elapsed-time budget was reached during stage "${stage}".`);
    this.name = 'RunPausedException';
  }
}
