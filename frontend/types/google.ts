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

export interface GscSitemapCoverage {
  path: string;
  submitted: number;
  indexed: number;
}

export interface GscIndexCoverage {
  submitted: number;
  indexed: number;
  notIndexed: number;
  sitemaps: GscSitemapCoverage[];
}

export interface GscOverview {
  siteUrl: string;
  days: number;
  totals: GscTotals;
  previousTotals: GscTotals;
  byQuery: GscRow[];
  byPage: GscRow[];
  byDate: GscDateRow[];
  pageInsights: PageInsight[];
  pageTrends: Array<{ url: string; date: string; clicks: number }>;
  indexCoverage: GscIndexCoverage | null;
}

export type PageTrend = 'up' | 'down' | 'new' | 'stable';
export type InsightLevel = 'win' | 'watch' | 'act';

export interface PageInsight {
  url: string;
  clicks: number;
  prevClicks: number | null;
  impressions: number;
  prevImpressions: number | null;
  position: number;
  prevPosition: number | null;
  onPageOne: boolean;
  trend: PageTrend;
  action: string | null;
  actionLevel: InsightLevel | null;
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
