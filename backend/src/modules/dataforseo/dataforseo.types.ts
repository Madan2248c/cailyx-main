/**
 * DataForSEO Types — scheduled paid SERP/backlink/keyword snapshots.
 *
 * Three datasets, append-only snapshots: every collect writes one
 * `dataforseo_snapshots` row per dataset. Nothing downstream edits a
 * snapshot — a re-collect supersedes by recency, never by mutation.
 *
 * @module dataforseo/dataforseo.types
 */

export const DATASETS = ['serp-ranks', 'backlinks-summary', 'keyword-overview'] as const;

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

export type DataforseoPayload = SerpRanksPayload | BacklinksSummaryPayload | KeywordOverviewPayload;

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
