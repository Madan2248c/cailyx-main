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

export type DataforseoPayload =
  | SerpRanksPayload
  | BacklinksSummaryPayload
  | KeywordOverviewPayload
  | BacklinkRowsPayload
  | ReferringDomainsPayload
  | TopPagesPayload
  | KeywordIdeasPayload;

export interface BacklinkRow {
  sourceUrl: string;
  targetUrl: string;
  anchor: string;
  isDofollow: boolean;
  spamScore: number;
  firstSeen: string | null;
  lastSeen: string | null;
  lost: boolean;
}

export interface BacklinkRowsPayload {
  dataset: 'backlink-rows';
  rows: BacklinkRow[];
}

export interface ReferringDomainRow {
  domain: string;
  backlinks: number;
  firstSeen: string | null;
}

export interface ReferringDomainsPayload {
  dataset: 'referring-domains';
  domains: ReferringDomainRow[];
}

export interface TopPageRow {
  url: string;
  backlinks: number;
  refDomains: number;
}

export interface TopPagesPayload {
  dataset: 'top-pages';
  pages: TopPageRow[];
}

export interface KeywordIdeaRow {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
}

export interface KeywordIdeasPayload {
  dataset: 'keyword-ideas';
  ideas: KeywordIdeaRow[];
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null;
}

function asNumber(raw: unknown, fallback = 0): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

/** Latest full snapshot for a dataset, or null when none exists yet. */
export async function getLatestSnapshot(
  accessToken: string,
  clientId: string,
  projectId: string,
  dataset: string,
): Promise<DataforseoSnapshot | null> {
  const snapshots = await listSnapshots(accessToken, clientId, projectId, dataset);
  if (snapshots.length === 0) return null;
  return getSnapshot(accessToken, clientId, snapshots[0].id);
}

export function backlinkRowsOf(snapshot: DataforseoSnapshot | null | undefined): BacklinkRow[] {
  if (!isRecord(snapshot?.payload)) return [];
  const payload = snapshot.payload as { dataset?: unknown; rows?: unknown };
  if (payload.dataset !== 'backlink-rows' || !Array.isArray(payload.rows)) return [];
  return payload.rows.filter(
    (row): row is BacklinkRow =>
      isRecord(row) && typeof row.sourceUrl === 'string' && typeof row.targetUrl === 'string',
  );
}

export function referringDomainsOf(snapshot: DataforseoSnapshot | null | undefined): ReferringDomainRow[] {
  if (!isRecord(snapshot?.payload)) return [];
  const payload = snapshot.payload as { dataset?: unknown; domains?: unknown };
  if (payload.dataset !== 'referring-domains' || !Array.isArray(payload.domains)) return [];
  return payload.domains.filter(
    (row): row is ReferringDomainRow => isRecord(row) && typeof row.domain === 'string',
  );
}

export function topPagesOf(snapshot: DataforseoSnapshot | null | undefined): TopPageRow[] {
  if (!isRecord(snapshot?.payload)) return [];
  const payload = snapshot.payload as { dataset?: unknown; pages?: unknown };
  if (payload.dataset !== 'top-pages' || !Array.isArray(payload.pages)) return [];
  return payload.pages.filter(
    (row): row is TopPageRow => isRecord(row) && typeof row.url === 'string',
  );
}

export function keywordIdeasOf(snapshot: DataforseoSnapshot | null | undefined): KeywordIdeaRow[] {
  if (!isRecord(snapshot?.payload)) return [];
  const payload = snapshot.payload as { dataset?: unknown; ideas?: unknown };
  if (payload.dataset !== 'keyword-ideas' || !Array.isArray(payload.ideas)) return [];
  return payload.ideas.filter(
    (row): row is KeywordIdeaRow => isRecord(row) && typeof row.keyword === 'string',
  );
}

export function backlinksSummaryOf(
  snapshot: DataforseoSnapshot | null | undefined,
): BacklinksSummaryPayload | null {
  if (!isRecord(snapshot?.payload)) return null;
  const payload = snapshot.payload as Partial<BacklinksSummaryPayload> & { dataset?: unknown };
  if (payload.dataset !== 'backlinks-summary') return null;
  return {
    dataset: 'backlinks-summary',
    referringDomains: asNumber(payload.referringDomains),
    newBacklinks: asNumber(payload.newBacklinks),
    lostBacklinks: asNumber(payload.lostBacklinks),
  };
}

export function keywordOverviewOf(snapshot: DataforseoSnapshot | null | undefined): KeywordOverviewRow[] {
  if (!isRecord(snapshot?.payload)) return [];
  const payload = snapshot.payload as { dataset?: unknown; keywords?: unknown };
  if (payload.dataset !== 'keyword-overview' || !Array.isArray(payload.keywords)) return [];
  return payload.keywords.filter(
    (row): row is KeywordOverviewRow =>
      isRecord(row) && typeof row.keyword === 'string' && typeof row.volume === 'number',
  );
}

export function coerceKeywordRow(raw: unknown): KeywordOverviewRow | null {
  if (!isRecord(raw) || typeof raw.keyword !== 'string') return null;
  return {
    keyword: raw.keyword,
    volume: asNumber(raw.volume),
    difficulty: asNumber(raw.difficulty),
    cpc: asNumber(raw.cpc),
  };
}

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
