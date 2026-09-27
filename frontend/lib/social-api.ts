import type { SocialActivityRun } from '@/types/social';

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

/**
 * This project's social-activity run history, newest first — via the BFF so
 * the browser never calls the backend directly. Reads use `view_projects`
 * (POC + member), enforced backend-side.
 */
export async function listSocialActivityRuns(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<SocialActivityRun[]> {
  const response = await fetch(`/api/team/clients/${clientId}/projects/${projectId}/social-activity-runs`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<SocialActivityRun[]>(response);
}
