import type { AeoAudit, AeoVerdict } from '@/types/aeo';
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

export async function listAeoAudits(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<AeoAudit[]> {
  const response = await apiFetch(`/api/team/clients/${clientId}/projects/${projectId}/aeo-audits`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<AeoAudit[]>(response);
}

export async function getAeoVerdict(
  accessToken: string,
  clientId: string,
  auditId: string,
): Promise<AeoVerdict> {
  const response = await apiFetch(`/api/team/clients/${clientId}/aeo-audits/${auditId}/verdict`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<AeoVerdict>(response);
}
