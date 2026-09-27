/**
 * Organic tab types — Google Search Console + Analytics overviews.
 * Reads only; connections are made through the connect cards.
 */

export interface GoogleStatus {
  gsc: { connected: boolean };
  ga: { connected: boolean };
}

export interface GscTotals {
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
}

export interface GscRow {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscDateRow extends GscRow {
  date: string;
}

export interface GscOverview {
  siteUrl: string;
  days: number;
  totals: GscTotals;
  previousTotals: GscTotals;
  byQuery: GscRow[];
  byPage: GscRow[];
  byDate: GscDateRow[];
}

export interface GaTotals {
  sessions: number;
  activeUsers: number;
  screenPageViews: number;
}

export interface GaDateRow extends GaTotals {
  date: string;
}

export interface GaOverview {
  propertyId: string;
  days: number;
  totals: GaTotals;
  previousTotals: GaTotals;
  byDate: GaDateRow[];
}
