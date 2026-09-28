import type { Project } from '@/types/project';
import { apiFetch } from '@/lib/api-cache';

async function parseOrThrow<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message ?? 'Something went wrong');
  }
  return data as T;
}

function authHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

export async function listProjects(accessToken: string, clientId: string): Promise<Project[]> {
  const response = await apiFetch(`/api/team/clients/${clientId}/projects`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<Project[]>(response);
}

export async function createProject(
  accessToken: string,
  clientId: string,
  name: string,
  domain: string,
  opts: { day1SpendConsent: boolean; day1SpendCeilingUsd?: number },
): Promise<Project> {
  const response = await apiFetch(`/api/team/clients/${clientId}/projects`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, domain, ...opts }),
  });
  return parseOrThrow<Project>(response);
}

export async function archiveProject(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<{ success: true }> {
  const response = await apiFetch(`/api/team/clients/${clientId}/projects/${projectId}/archive`, {
    method: 'PATCH',
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<{ success: true }>(response);
}
