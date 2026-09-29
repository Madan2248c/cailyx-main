/**
 * Everything the admin can do to a client's project from the preview: trigger
 * runs, publish reports, change competitors, add or remove fixes, edit the
 * prompts the AI audit asks. Each one is a thin call to the backend through
 * `/api/proxy`, which forwards the admin's own token; the backend's role and
 * client guards make the actual decision.
 */

import { apiFetch } from '@/lib/api-cache';
import type { FixSpec } from '@/types/remediation';

async function call<T>(accessToken: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await apiFetch(`/api/proxy${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'message' in data ? (data as { message: unknown }).message : null;
    throw new Error(Array.isArray(message) ? message.join(', ') : message ? String(message) : 'Something went wrong');
  }
  return data as T;
}

const proj = (clientId: string, projectId: string) => `/clients/${clientId}/projects/${projectId}`;

// ─── Runs ─────────────────────────────────────────────────────────────────

export const runTechnicalAudit = (t: string, c: string, p: string) => call<unknown>(t, 'POST', `${proj(c, p)}/technical-audit-runs`);

/** Social pulls spend on scrapers; the backend insists on `confirmSpend`. */
export const runSocialActivity = (t: string, c: string, p: string) =>
  call<unknown>(t, 'POST', `${proj(c, p)}/social-activity-runs`, { confirmSpend: true });

export const runGapAnalysis = (t: string, c: string, p: string) => call<unknown>(t, 'POST', `${proj(c, p)}/gap-analysis/runs`);

export const syncFixPlanNow = (t: string, c: string, p: string) =>
  call<{ created: number; updated: number; verified: number; regressed: number }>(t, 'POST', `${proj(c, p)}/remediation/sync`);

export const discoverCompetitors = (t: string, c: string, p: string) => call<unknown>(t, 'POST', `${proj(c, p)}/competitors/discover`);

export const AI_SURFACES = [
  { key: 'cloro_chatgpt', label: 'ChatGPT' },
  { key: 'cloro_perplexity', label: 'Perplexity' },
  { key: 'cloro_gemini', label: 'Gemini' },
  { key: 'cloro_ai_overview', label: 'Google AI Overview' },
  { key: 'cloro_ai_mode', label: 'Google AI Mode' },
] as const;

export interface QuerySetSummary {
  id: string;
  version: number;
  label: string | null;
  status: 'draft' | 'active' | 'archived';
  source: string;
  items?: QuerySetItem[];
  _count?: { items: number };
}

export interface QuerySetItem {
  id: string;
  prompt: string;
  funnelStage: string;
  branding: string | null;
}

export const listQuerySets = (t: string, c: string, p: string) => call<QuerySetSummary[]>(t, 'GET', `${proj(c, p)}/query-sets`);
export const getQuerySet = (t: string, c: string, id: string) => call<QuerySetSummary & { items: QuerySetItem[] }>(t, 'GET', `/clients/${c}/query-sets/${id}`);
export const addPrompt = (t: string, c: string, id: string, prompt: string) =>
  call<unknown>(t, 'POST', `/clients/${c}/query-sets/${id}/prompts`, { prompt });
export const removePrompt = (t: string, c: string, id: string, itemId: string) => call<unknown>(t, 'DELETE', `/clients/${c}/query-sets/${id}/prompts/${itemId}`);
export const activateQuerySet = (t: string, c: string, id: string) => call<unknown>(t, 'POST', `/clients/${c}/query-sets/${id}/activate`);
export const forkQuerySet = (t: string, c: string, id: string) => call<QuerySetSummary>(t, 'POST', `/clients/${c}/query-sets/${id}/fork`);

/** Creates an audit on a query set and drives it to completion. Spends real credit on the AI engines. */
export async function runAeoAudit(t: string, c: string, p: string, querySetId: string, surfaces: string[]): Promise<void> {
  const audit = await call<{ id: string }>(t, 'POST', `${proj(c, p)}/aeo-audits`, { querySetId, surfaces });
  await call<unknown>(t, 'POST', `/clients/${c}/aeo-audits/${audit.id}/run`);
}

// ─── Reports ──────────────────────────────────────────────────────────────

export const generateReport = (t: string, c: string, p: string, kind: 'DAY1' | 'MONTHLY') => call<{ id: string }>(t, 'POST', `${proj(c, p)}/reports`, { kind });
export const editReport = (t: string, c: string, reportId: string, patch: { title?: string; executiveSummary?: string }) =>
  call<unknown>(t, 'PATCH', `/clients/${c}/reports/${reportId}`, patch);
export const publishReport = (t: string, c: string, reportId: string) => call<unknown>(t, 'POST', `/clients/${c}/reports/${reportId}/publish`);
export const withdrawReport = (t: string, c: string, reportId: string) => call<unknown>(t, 'POST', `/clients/${c}/reports/${reportId}/withdraw`);
export const createReportShareLink = (t: string, c: string, reportId: string) =>
  call<{ token: string; id: string }>(t, 'POST', `/clients/${c}/reports/${reportId}/share-links`);

// ─── Fixes ────────────────────────────────────────────────────────────────

export interface ManualFixInput {
  title: string;
  target: string;
  fixClass: 'CODE' | 'CONFIG' | 'CONTENT' | 'OFF_SITE' | 'INVESTIGATE';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  effort: 'LOW' | 'MEDIUM' | 'HIGH';
  steps: string[];
  note?: string;
  groupKey?: string;
  needsClientDecision?: boolean;
}

export const createManualFix = (t: string, c: string, p: string, input: ManualFixInput) =>
  call<FixSpec>(t, 'POST', `${proj(c, p)}/remediation/fixes`, input);

export type SettableFixStatus = 'OPEN' | 'IN_PROGRESS' | 'APPLIED' | 'DISMISSED' | 'VERIFIED';

export const setFixStatus = (t: string, c: string, fixId: string, change: { status: SettableFixStatus; reason?: string; prUrl?: string; note?: string }) =>
  call<FixSpec>(t, 'PATCH', `/clients/${c}/remediation/fixes/${fixId}/status`, change);

export const deleteManualFix = (t: string, c: string, fixId: string) => call<{ success: true }>(t, 'DELETE', `/clients/${c}/remediation/fixes/${fixId}`);
export const draftFix = (t: string, c: string, fixId: string) => call<FixSpec>(t, 'POST', `/clients/${c}/remediation/fixes/${fixId}/draft`);
export const setDraftShared = (t: string, c: string, fixId: string, shared: boolean) =>
  call<FixSpec>(t, 'PATCH', `/clients/${c}/remediation/fixes/${fixId}/draft-shared`, { shared });
