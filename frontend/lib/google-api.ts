import type { GaOverview, GoogleStatus, GscOverview } from '@/types/google';
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

/** Fetches the consent URL then navigates the whole tab to Google (does not resolve usefully — the page unloads). */
export async function startGoogleConnect(accessToken: string, clientId: string, provider: 'gsc' | 'ga'): Promise<void> {
  const response = await apiFetch(`/api/team/clients/${clientId}/google/connect-url?provider=${provider}`, {
    headers: authHeaders(accessToken),
    cache: 'no-store', // never served from the portal cache
  });
  const data = await parseOrThrow<{ url: string }>(response);
  window.location.href = data.url;
}

export async function getGoogleStatus(accessToken: string, clientId: string): Promise<GoogleStatus> {
  const response = await apiFetch(`/api/team/clients/${clientId}/google/status`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<GoogleStatus>(response);
}

export async function getSearchConsole(
  accessToken: string,
  clientId: string,
  projectId: string,
  siteUrl?: string,
): Promise<GscOverview> {
  const params = siteUrl ? `?siteUrl=${encodeURIComponent(siteUrl)}` : '';
  const response = await apiFetch(`/api/team/clients/${clientId}/projects/${projectId}/google/search-console${params}`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<GscOverview>(response);
}

export async function getAnalytics(
  accessToken: string,
  clientId: string,
  projectId: string,
  propertyId?: string,
): Promise<GaOverview> {
  const params = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const response = await apiFetch(`/api/team/clients/${clientId}/projects/${projectId}/google/analytics${params}`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<GaOverview>(response);
}

export async function listGscSites(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<string[]> {
  const response = await apiFetch(`/api/team/clients/${clientId}/projects/${projectId}/google/sites`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<string[]>(response);
}

export async function listGaProperties(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<Array<{ id: string; name: string }>> {
  const response = await apiFetch(`/api/team/clients/${clientId}/projects/${projectId}/google/properties`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<Array<{ id: string; name: string }>>(response);
}
