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

/**
 * Downloads the report as the branded PDF (dark cover, numbered sections).
 * The file name comes from the server, with `fallbackName` as a backstop.
 * Nothing is saved on a failed response — the caller shows the error.
 */
export async function downloadReportPdf(
  accessToken: string,
  clientId: string,
  reportId: string,
  fallbackName: string,
): Promise<void> {
  const response = await fetch(`/api/team/clients/${clientId}/reports/${reportId}/pdf`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) throw new Error('Could not prepare the report PDF. Please try again.');
  const filename = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
