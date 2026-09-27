import type { TechnicalAuditRun, TrendPoint } from '@/types/technical';

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

export async function listTechnicalAuditRuns(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<TechnicalAuditRun[]> {
  const response = await fetch(`/api/team/clients/${clientId}/projects/${projectId}/technical-audit-runs`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<TechnicalAuditRun[]>(response);
}

export async function getTechnicalAuditTrend(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<TrendPoint[]> {
  const response = await fetch(`/api/team/clients/${clientId}/projects/${projectId}/technical-audit-trend`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<TrendPoint[]>(response);
}
