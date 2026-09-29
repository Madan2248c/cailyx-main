import { apiFetch } from '@/lib/api-cache';
/**
 * Settings-tab fetchers. Read-only: the backend exposes no write endpoints
 * for client settings, so this tab only reads.
 *
 * Day-1 pipeline status is admin-only on the backend — client roles get a
 * 403, which callers treat as "hide the section", never as an error.
 */

export type Day1StageState = 'completed' | 'failed' | 'skipped';

export interface Day1StageRecord {
  status: Day1StageState;
  runId?: string;
  error?: string;
  skippedReason?: string;
  /** When the step settled. Absent on runs from before this was recorded. */
  finishedAt?: string;
}

export interface Day1Status {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  currentStage: string | null;
  stages: Partial<Record<string, Day1StageRecord>>;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
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

export async function getDay1Status(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<Day1Status> {
  const response = await apiFetch(`/api/team/clients/${clientId}/projects/${projectId}/day1`, {
    headers: authHeaders(accessToken),
    cache: 'no-store', // never served from the portal cache
  });
  return parseOrThrow<Day1Status>(response);
}
