/**
 * TypeScript interfaces for the fetcher module.
 *
 * PSI (PageSpeed Insights) types are intentionally not ported — that
 * concern belongs to the later Technical Audit module, not this one.
 * See docs/analysis/discovery.md.
 *
 * @module fetcher.types
 */

// ─── Fetch (raw HTTP) ───────────────────────────────────────────

export interface FetchOptions {
  url: string;
  userAgent?: string;
  method?: 'GET' | 'POST' | 'HEAD';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  retries?: number;
  /** If true, skip cache lookup and always fetch fresh */
  bypassCache?: boolean;
  /** Cache TTL in seconds (0 = no cache, default depends on URL type) */
  cacheTtlSeconds?: number;
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  timing: {
    latencyMs: number;
  };
  userAgent: string;
  cached: boolean;
  retryCount: number;
}

// ─── Probe (access probe with specific UA) ──────────────────────

export interface ProbeOptions {
  url: string;
  userAgent: string;
  botName: string;
  retries?: number;
  /** Number of times to repeat the probe for determinism (default 3) */
  repeat?: number;
}

export interface ProbeAttempt {
  attempt: number;
  status: number;
  latencyMs: number;
  blocked: boolean;
}

export interface ProbeResult {
  url: string;
  botName: string;
  userAgent: string;
  /** Stable status code across all attempts (most common) */
  status: number;
  /** True if the stable status indicates a block (403, 401, 429, 503) */
  blocked: boolean;
  latencyMs: number;
  attempts: ProbeAttempt[];
  /** True if different attempts returned different statuses (flapping) */
  inconsistent: boolean;
}

// ─── Render (headless browser) ──────────────────────────────────

export interface RenderOptions {
  url: string;
  jsDisabled?: boolean;
  timeout?: number;
  /** If true, capture a screenshot as base64 PNG */
  screenshot?: boolean;
}

export interface RenderResult {
  url: string;
  finalUrl: string;
  html: string;
  text: string;
  title: string;
  screenshot?: string;
  timing: {
    latencyMs: number;
  };
  jsDisabled: boolean;
}

// ─── Schema (JSON-LD extraction) ────────────────────────────────

export interface SchemaResult {
  url: string;
  /** The underlying fetch's real HTTP status — 0 on a network failure, else whatever the server returned. */
  status: number;
  schemas: SchemaBlock[];
  raw: string;
}

export interface SchemaBlock {
  type: string;
  fields: Record<string, unknown>;
}

// ─── Verify URL (sameAs check) ──────────────────────────────────

export interface VerifyUrlOptions {
  url: string;
  expectedName?: string;
}

export interface VerifyUrlResult {
  url: string;
  finalUrl: string;
  resolves: boolean;
  statusCode?: number;
  title?: string;
  identityMatch?: boolean;
  checkedAt: string;
}

// ─── Fetch Log ──────────────────────────────────────────────────

export interface FetchLogEntry {
  id: string;
  runId?: string;
  calledBy: string;
  method: string;
  url: string;
  userAgent: string;
  httpStatus: number;
  latencyMs: number;
  cost: number;
  cached: boolean;
  retryCount: number;
  timestamp: string;
}

// ─── Cost Tracking ──────────────────────────────────────────────

export interface CostEntry {
  runId: string;
  method: string;
  cost: number;
  timestamp: string;
}

// ─── Circuit Breaker ────────────────────────────────────────────

export interface CircuitBreakerState {
  domain: string;
  failures: number;
  isOpen: boolean;
  openedAt?: number;
  lastFailureAt?: number;
}
