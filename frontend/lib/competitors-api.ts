import type { CompetitorWithProfile, GapResponse } from '@/types/competitor';
import { apiFetch } from '@/lib/api-cache';

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

export async function listCompetitorProfiles(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<CompetitorWithProfile[]> {
  const response = await apiFetch(`/api/team/clients/${clientId}/projects/${projectId}/competitors`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<CompetitorWithProfile[]>(response);
}

export async function getCompetitorsGap(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<GapResponse> {
  const response = await apiFetch(
    `/api/team/clients/${clientId}/projects/${projectId}/competitors/gap`,
    {
      headers: authHeaders(accessToken),
    },
  );
  return parseOrThrow<GapResponse>(response);
}
