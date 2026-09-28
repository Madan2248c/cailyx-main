import type { FixSpec, FixStatus, FixSummary } from '@/types/remediation';

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

function headers(accessToken: string, json = false): HeadersInit {
  return { Authorization: `Bearer ${accessToken}`, ...(json ? { 'Content-Type': 'application/json' } : {}) };
}

const projectBase = (clientId: string, projectId: string) => `/api/team/clients/${clientId}/projects/${projectId}/remediation`;
const fixBase = (clientId: string, fixId: string) => `/api/team/clients/${clientId}/remediation/fixes/${fixId}`;

export async function listFixes(accessToken: string, clientId: string, projectId: string, status?: FixStatus[]): Promise<FixSpec[]> {
  const qs = status?.length ? `?status=${status.join(',')}` : '';
  return parseOrThrow<FixSpec[]>(await fetch(`${projectBase(clientId, projectId)}/fixes${qs}`, { headers: headers(accessToken) }));
}

export async function getFixSummary(accessToken: string, clientId: string, projectId: string): Promise<FixSummary> {
  return parseOrThrow<FixSummary>(await fetch(`${projectBase(clientId, projectId)}/summary`, { headers: headers(accessToken) }));
}

export async function getFix(accessToken: string, clientId: string, fixId: string): Promise<FixSpec> {
  return parseOrThrow<FixSpec>(await fetch(fixBase(clientId, fixId), { headers: headers(accessToken) }));
}

export async function decideFix(
  accessToken: string,
  clientId: string,
  fixId: string,
  decision: 'APPROVED' | 'DECLINED',
  note?: string,
): Promise<FixSpec> {
  return parseOrThrow<FixSpec>(
    await fetch(`${fixBase(clientId, fixId)}/decision`, {
      method: 'POST',
      headers: headers(accessToken, true),
      body: JSON.stringify({ decision, ...(note?.trim() ? { note: note.trim() } : {}) }),
    }),
  );
}

export async function markFixApplied(
  accessToken: string,
  clientId: string,
  fixId: string,
  input: { note?: string; prUrl?: string },
): Promise<FixSpec> {
  const body: Record<string, string> = {};
  if (input.note?.trim()) body.note = input.note.trim();
  if (input.prUrl?.trim()) body.prUrl = input.prUrl.trim();
  return parseOrThrow<FixSpec>(
    await fetch(`${fixBase(clientId, fixId)}/client-applied`, { method: 'POST', headers: headers(accessToken, true), body: JSON.stringify(body) }),
  );
}

export async function verifyFix(accessToken: string, clientId: string, fixId: string): Promise<FixSpec> {
  return parseOrThrow<FixSpec>(await fetch(`${fixBase(clientId, fixId)}/verify`, { method: 'POST', headers: headers(accessToken) }));
}

/** Staff only: rebuild the plan from the latest audits. */
export async function syncFixPlan(accessToken: string, clientId: string, projectId: string): Promise<{ created: number; updated: number; verified: number; regressed: number }> {
  return parseOrThrow(await fetch(`${projectBase(clientId, projectId)}/sync`, { method: 'POST', headers: headers(accessToken) }));
}

/** The fix pack as a Markdown file download, for the client's developer. */
export async function downloadFixPack(accessToken: string, clientId: string, projectId: string, filename: string): Promise<void> {
  const response = await fetch(`${projectBase(clientId, projectId)}/export?format=md`, { headers: headers(accessToken) });
  if (!response.ok) throw new Error('Could not prepare the download. Please try again.');
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
