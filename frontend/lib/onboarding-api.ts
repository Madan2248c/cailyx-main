import { apiFetch } from '@/lib/api-cache';
import type {
  CompanyContextResponse,
  Competitor,
  ProfileFieldUpdates,
  SocialProfile,
} from '@/types/onboarding';

async function parseOrThrow<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(errorMessage(data));
  }
  return data as T;
}

function errorMessage(data: unknown): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const message = (data as { message: unknown }).message;
    if (Array.isArray(message)) return message.map(String).join(', ');
    if (typeof message === 'string') return message;
  }
  return 'Something went wrong';
}

function authHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

function projectBase(clientId: string, projectId: string) {
  return `/api/team/clients/${clientId}/projects/${projectId}`;
}

export async function getCompanyContext(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<CompanyContextResponse | null> {
  const response = await apiFetch(`${projectBase(clientId, projectId)}/company-context`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<CompanyContextResponse | null>(response);
}

export async function patchCompanyContext(
  accessToken: string,
  clientId: string,
  projectId: string,
  fields: ProfileFieldUpdates,
): Promise<CompanyContextResponse> {
  const response = await apiFetch(`${projectBase(clientId, projectId)}/company-context`, {
    method: 'PATCH',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  return parseOrThrow<CompanyContextResponse>(response);
}

export async function listSocialProfiles(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<SocialProfile[]> {
  const response = await apiFetch(`${projectBase(clientId, projectId)}/social-profiles`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<SocialProfile[]>(response);
}

export async function patchSocialProfile(
  accessToken: string,
  clientId: string,
  projectId: string,
  socialId: string,
  url: string,
): Promise<SocialProfile> {
  const response = await apiFetch(`${projectBase(clientId, projectId)}/social-profiles/${socialId}`, {
    method: 'PATCH',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return parseOrThrow<SocialProfile>(response);
}

export async function listCompetitors(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<Competitor[]> {
  const response = await apiFetch(`${projectBase(clientId, projectId)}/competitors`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<Competitor[]>(response);
}

export async function patchCompetitor(
  accessToken: string,
  clientId: string,
  projectId: string,
  competitorId: string,
  patch: { name?: string; domain?: string | null; status?: 'tracked' | 'candidate' },
): Promise<Competitor> {
  const response = await apiFetch(`${projectBase(clientId, projectId)}/competitors/${competitorId}`, {
    method: 'PATCH',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return parseOrThrow<Competitor>(response);
}

export async function addCompetitor(
  accessToken: string,
  clientId: string,
  projectId: string,
  input: { name: string; domain?: string },
): Promise<Competitor> {
  const response = await apiFetch(`${projectBase(clientId, projectId)}/competitors/manual`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseOrThrow<Competitor>(response);
}
