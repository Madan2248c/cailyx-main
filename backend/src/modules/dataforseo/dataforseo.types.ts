/**
 * DataForSEO Types — scheduled paid SERP/backlink/keyword snapshots.
 *
 * Nine datasets, append-only snapshots: every collect writes one
 * `dataforseo_snapshots` row per dataset. Nothing downstream edits a
 * snapshot — a re-collect supersedes by recency, never by mutation.
 *
 * @module dataforseo/dataforseo.types
 */

export const DATASETS = [
  'serp-ranks',
  'backlinks-summary',
  'keyword-overview',
  'backlink-rows',
  'referring-domains',
  'top-pages',
  'keyword-ideas',
  'serp-snapshot',
  'domain-overview',
] as const;

export type DataforseoDataset = (typeof DATASETS)[number];

/** One SERP ranking row inside a `serp-ranks` payload. */
export interface SerpRankRow {
  keyword: string;
  url: string;
  position: number;
  /** Previous position, null when the keyword is new to tracking. */
  prevPosition: number | null;
  volume: number;
}

/** `serp-ranks` snapshot payload. */
export interface SerpRanksPayload {
  dataset: 'serp-ranks';
  rankings: SerpRankRow[];
}

/** `backlinks-summary` snapshot payload. */
export interface BacklinksSummaryPayload {
  dataset: 'backlinks-summary';
  referringDomains: number;
  newBacklinks: number;
  lostBacklinks: number;
}

/** One keyword row inside a `keyword-overview` payload. */
export interface KeywordOverviewRow {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
}

/** `keyword-overview` snapshot payload. */
export interface KeywordOverviewPayload {
  dataset: 'keyword-overview';
  keywords: KeywordOverviewRow[];
}

/** One backlink row inside a `backlink-rows` payload. */
export interface BacklinkRow {
  sourceUrl: string;
  targetUrl: string;
  anchor: string;
  isDofollow: boolean;
  /** Spam score 0–100, null when the source gives none. */
  spamScore: number | null;
  /** ISO dates, null when the source gives none. */
  firstSeen: string | null;
  lastSeen: string | null;
  lost: boolean;
}

/** `backlink-rows` snapshot payload. */
export interface BacklinkRowsPayload {
  dataset: 'backlink-rows';
  backlinks: BacklinkRow[];
}

/** One referring-domain row inside a `referring-domains` payload. */
export interface ReferringDomainRow {
  domain: string;
  backlinks: number;
  /** ISO date, null when the source gives none. */
  firstSeen: string | null;
}

/** `referring-domains` snapshot payload (top 10 by backlinks). */
export interface ReferringDomainsPayload {
  dataset: 'referring-domains';
  domains: ReferringDomainRow[];
}

/** One page row inside a `top-pages` payload. */
export interface TopPageRow {
  url: string;
  backlinks: number;
  refDomains: number;
}

/** `top-pages` snapshot payload (top 10 by backlinks). */
export interface TopPagesPayload {
  dataset: 'top-pages';
  pages: TopPageRow[];
}

/** One keyword-idea row inside a `keyword-ideas` payload. */
export interface KeywordIdeaRow {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
}

/** `keyword-ideas` snapshot payload. */
export interface KeywordIdeasPayload {
  dataset: 'keyword-ideas';
  keywords: KeywordIdeaRow[];
}

/** One organic result inside a `serp-snapshot` payload. */
export interface SerpSnapshotResultRow {
  position: number;
  url: string;
  title: string;
  features: string[];
}

/** `serp-snapshot` snapshot payload (top 10 results for one keyword). */
export interface SerpSnapshotPayload {
  dataset: 'serp-snapshot';
  keyword: string;
  results: SerpSnapshotResultRow[];
}

/** `domain-overview` snapshot payload for the project domain. */
export interface DomainOverviewPayload {
  dataset: 'domain-overview';
  rank: number;
  rankedKeywords: number;
  trafficEstimate: number;
  refDomains: number;
}

export type DataforseoPayload =
  | SerpRanksPayload
  | BacklinksSummaryPayload
  | KeywordOverviewPayload
  | BacklinkRowsPayload
  | ReferringDomainsPayload
  | TopPagesPayload
  | KeywordIdeasPayload
  | SerpSnapshotPayload
  | DomainOverviewPayload;

/** What one adapter call for one dataset returns. */
export interface DatasetResult {
  payload: DataforseoPayload;
  costUsd: number;
}

/**
 * One `DataforseoDataset` adapter — the live adapter later without
 * touching the service. This build wires only the mock: every paid path
 * goes through it, and it never touches the network.
 */
export interface DataforseoAdapter {
  readonly name: 'mock' | 'live';
  fetchDataset(dataset: DataforseoDataset, domain: string): Promise<DatasetResult>;
}
