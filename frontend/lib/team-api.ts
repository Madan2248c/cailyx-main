import type { ClientSummary, TeamMember, TeamMembers } from '@/types/team';

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

export async function listClients(accessToken: string): Promise<ClientSummary[]> {
  const response = await fetch('/api/team/clients', { headers: authHeaders(accessToken) });
  return parseOrThrow<ClientSummary[]>(response);
}

export async function createClient(
  accessToken: string,
  name: string,
  pocEmail: string,
  seatLimit?: number,
): Promise<{ client: ClientSummary }> {
  const response = await fetch('/api/team/clients', {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, pocEmail, seatLimit }),
  });
  return parseOrThrow<{ client: ClientSummary }>(response);
}

export async function updateSeatLimit(
  accessToken: string,
  id: string,
  seatLimit: number,
): Promise<{ success: true }> {
  const response = await fetch(`/api/team/clients/${id}/seats`, {
    method: 'PATCH',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ seatLimit }),
  });
  return parseOrThrow<{ success: true }>(response);
}

export async function suspendClient(accessToken: string, id: string): Promise<{ success: true }> {
  const response = await fetch(`/api/team/clients/${id}/suspend`, {
    method: 'PATCH',
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<{ success: true }>(response);
}

export async function activateClient(accessToken: string, id: string): Promise<{ success: true }> {
  const response = await fetch(`/api/team/clients/${id}/activate`, {
    method: 'PATCH',
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<{ success: true }>(response);
}

export async function listMembers(accessToken: string): Promise<TeamMembers> {
  const response = await fetch('/api/team/members', { headers: authHeaders(accessToken) });
  return parseOrThrow<TeamMembers>(response);
}

export async function inviteMember(accessToken: string, email: string): Promise<TeamMember> {
  const response = await fetch('/api/team/invite', {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return parseOrThrow<TeamMember>(response);
}

export async function resendInvite(accessToken: string, id: string): Promise<{ success: true }> {
  const response = await fetch(`/api/team/users/${id}/resend-invite`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<{ success: true }>(response);
}

export async function disableMember(accessToken: string, id: string): Promise<{ success: true }> {
  const response = await fetch(`/api/team/users/${id}/disable`, {
    method: 'PATCH',
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<{ success: true }>(response);
}

export async function enableMember(accessToken: string, id: string): Promise<{ success: true }> {
  const response = await fetch(`/api/team/users/${id}/enable`, {
    method: 'PATCH',
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<{ success: true }>(response);
}
