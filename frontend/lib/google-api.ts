import type { GaOverview, GoogleStatus, GscOverview } from '@/types/google';

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
  const response = await fetch(`/api/team/clients/${clientId}/google/connect-url?provider=${provider}`, {
    headers: authHeaders(accessToken),
  });
  const data = await parseOrThrow<{ url: string }>(response);
  window.location.href = data.url;
}

export async function getGoogleStatus(accessToken: string, clientId: string): Promise<GoogleStatus> {
  const response = await fetch(`/api/team/clients/${clientId}/google/status`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<GoogleStatus>(response);
}

export async function getSearchConsole(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<GscOverview> {
  const response = await fetch(`/api/team/clients/${clientId}/projects/${projectId}/google/search-console`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<GscOverview>(response);
}

export async function getAnalytics(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<GaOverview> {
  const response = await fetch(`/api/team/clients/${clientId}/projects/${projectId}/google/analytics`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<GaOverview>(response);
}
