/**
 * Admin-only DataForSEO fetchers — BFF-first mirrors of the backend's
 * dataforseo-schedule (GET/PUT) and dataforseo-collect (POST) endpoints.
 * Same conventions as lib/schedules-api.ts: parseOrThrow + authHeaders,
 * backend-relative /api/team/... URLs.
 */

import type { ScheduleCadence } from '@/lib/schedules-api';

/** The 9 known DataForSEO datasets (backend DATASETS, dataforseo.types). */
export const DATAFORSEO_DATASETS = [
  'serp-ranks',
  'backlinks-summary',
  'backlink-rows',
  'referring-domains',
  'top-pages',
  'keyword-overview',
  'keyword-ideas',
  'serp-snapshot',
  'domain-overview',
] as const;

export type DataforseoDataset = (typeof DATAFORSEO_DATASETS)[number];

export interface DataforseoSchedule {
  id: string;
  projectId: string;
  cadence: ScheduleCadence;
  active: boolean;
  datasets: string[];
  spendOptIn: boolean;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DataforseoCollectResult {
  snapshots: Array<{ id: string; dataset: string; costUsd: number }>;
  totalCostUsd: number;
  skipped: string[];
}

async function parseOrThrow<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      data && typeof data === 'object' && 'message' in data
        ? String((data as { message: unknown }).message)
        : 'Something went wrong',
    );
  }
  return data as T;
}

function authHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

function scheduleUrl(clientId: string, projectId: string): string {
  return `/api/team/clients/${clientId}/projects/${projectId}/dataforseo-schedule`;
}

function collectUrl(clientId: string, projectId: string): string {
  return `/api/team/clients/${clientId}/projects/${projectId}/dataforseo-collect`;
}

export async function getDataforseoSchedule(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<DataforseoSchedule | null> {
  const response = await fetch(scheduleUrl(clientId, projectId), {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<DataforseoSchedule | null>(response);
}

export async function setDataforseoSchedule(
  accessToken: string,
  clientId: string,
  projectId: string,
  input: { cadence: ScheduleCadence; datasets?: string[]; spendOptIn?: boolean },
): Promise<DataforseoSchedule> {
  const response = await fetch(scheduleUrl(clientId, projectId), {
    method: 'PUT',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseOrThrow<DataforseoSchedule>(response);
}

export async function collectDataforseoNow(
  accessToken: string,
  clientId: string,
  projectId: string,
  datasets?: string[],
): Promise<DataforseoCollectResult> {
  const response = await fetch(collectUrl(clientId, projectId), {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(datasets ? { datasets } : {}),
  });
  return parseOrThrow<DataforseoCollectResult>(response);
}
