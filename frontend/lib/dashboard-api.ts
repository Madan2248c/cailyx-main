import type {
  CompetitorGap,
  GapAnalysisRun,
  ProjectReport,
  SocialActivityRun,
} from '@/types/dashboard';

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

export async function getCompetitorGap(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<CompetitorGap> {
  const response = await fetch(`/api/team/clients/${clientId}/projects/${projectId}/competitors/gap`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<CompetitorGap>(response);
}

export async function listGapAnalysisRuns(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<GapAnalysisRun[]> {
  const response = await fetch(`/api/team/clients/${clientId}/projects/${projectId}/gap-analysis-runs`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<GapAnalysisRun[]>(response);
}

export async function getGapAnalysisRun(
  accessToken: string,
  clientId: string,
  runId: string,
): Promise<GapAnalysisRun> {
  const response = await fetch(`/api/team/clients/${clientId}/gap-analysis-runs/${runId}`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<GapAnalysisRun>(response);
}

export async function listReports(
  accessToken: string,
  clientId: string,
  projectId: string,
): Promise<ProjectReport[]> {
  const response = await fetch(`/api/team/clients/${clientId}/projects/${projectId}/reports`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<ProjectReport[]>(response);
}
