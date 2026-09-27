/**
 * Schedules tab client — BFF-first mirrors of the backend's two real
 * schedule endpoints (technical-audit + social-activity). Reporting and
 * AEO have no schedule endpoints backend-side, so there is deliberately
 * no fetcher for them here — the page renders "not scheduled yet" gaps.
 */

export type ScheduleCadence = 'WEEKLY' | 'MONTHLY' | 'MANUAL_ONLY';

export interface TechnicalAuditSchedule {
  id: string;
  projectId: string;
  cadence: ScheduleCadence;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SocialActivitySchedule {
  id: string;
  projectId: string;
  cadence: ScheduleCadence;
  active: boolean;
  platforms: string[];
  windowDays: number | null;
  postsPerPlatform: number | null;
  spendOptIn: boolean;
  createdAt: string;
  updatedAt: string;
}

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

function scheduleUrl(clientId: string, projectId: string, kind: string): string {
  return `/api/team/clients/${clientId}/projects/${projectId}/${kind}-schedule`;
}

export async function getTechnicalAuditSchedule(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<TechnicalAuditSchedule | null> {
  const response = await fetch(scheduleUrl(clientId, projectId, 'technical-audit'), {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<TechnicalAuditSchedule | null>(response);
}

export async function setTechnicalAuditSchedule(
  accessToken: string,
  clientId: string,
  projectId: string,
  cadence: ScheduleCadence,
): Promise<TechnicalAuditSchedule> {
  const response = await fetch(scheduleUrl(clientId, projectId, 'technical-audit'), {
    method: 'PUT',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ cadence }),
  });
  return parseOrThrow<TechnicalAuditSchedule>(response);
}

export async function getSocialActivitySchedule(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<SocialActivitySchedule | null> {
  const response = await fetch(scheduleUrl(clientId, projectId, 'social-activity'), {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<SocialActivitySchedule | null>(response);
}

export async function setSocialActivitySchedule(
  accessToken: string,
  clientId: string,
  projectId: string,
  cadence: ScheduleCadence,
): Promise<SocialActivitySchedule> {
  const response = await fetch(scheduleUrl(clientId, projectId, 'social-activity'), {
    method: 'PUT',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ cadence }),
  });
  return parseOrThrow<SocialActivitySchedule>(response);
}
