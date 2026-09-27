export interface SerpRankRow {
  keyword: string;
  url: string;
  position: number;
  /** Previous position, null when the keyword is new to tracking. */
  prevPosition: number | null;
  volume: number;
}

export interface SerpRanksPayload {
  dataset: 'serp-ranks';
  rankings: SerpRankRow[];
}

export interface BacklinksSummaryPayload {
  dataset: 'backlinks-summary';
  referringDomains: number;
  newBacklinks: number;
  lostBacklinks: number;
}

export interface KeywordOverviewRow {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
}

export interface KeywordOverviewPayload {
  dataset: 'keyword-overview';
  keywords: KeywordOverviewRow[];
}

export type DataforseoPayload = SerpRanksPayload | BacklinksSummaryPayload | KeywordOverviewPayload;

export interface DataforseoSnapshot {
  id: string;
  projectId: string;
  dataset: string;
  periodStart: string | null;
  periodEnd: string | null;
  payload: DataforseoPayload;
  costUsd: number | null;
  createdAt: string;
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

export async function listSnapshots(
  accessToken: string,
  clientId: string,
  projectId: string,
  dataset?: string,
): Promise<DataforseoSnapshot[]> {
  const path =
    `/api/team/clients/${clientId}/projects/${projectId}/dataforseo-snapshots` +
    (dataset ? `?dataset=${encodeURIComponent(dataset)}` : '');
  const response = await fetch(path, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<DataforseoSnapshot[]>(response);
}

export async function getSnapshot(
  accessToken: string,
  clientId: string,
  snapshotId: string,
): Promise<DataforseoSnapshot> {
  const response = await fetch(`/api/team/clients/${clientId}/dataforseo-snapshots/${snapshotId}`, {
    headers: authHeaders(accessToken),
  });
  return parseOrThrow<DataforseoSnapshot>(response);
}
