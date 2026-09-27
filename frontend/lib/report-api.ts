import type { ReportDetail, ReportListItem } from '@/types/report';

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

export async function listReports(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<ReportListItem[]> {
  const response = await fetch(`/api/team/clients/${clientId}/projects/${projectId}/reports`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<ReportListItem[]>(response);
}

export async function getReport(
  accessToken: string,
  clientId: string,
  reportId: string,
): Promise<ReportDetail> {
  const response = await fetch(`/api/team/clients/${clientId}/reports/${reportId}`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<ReportDetail>(response);
}
