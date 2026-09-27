/**
 * Google module types — Search Console + Analytics over one per-client
 * OAuth connection. See docs/analysis/google.md.
 *
 * @module google/google.types
 */

export type GoogleProvider = 'gsc' | 'ga';

export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
export const GA_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

export const PROVIDER_SCOPES: Record<GoogleProvider, string> = {
  gsc: GSC_SCOPE,
  ga: GA_SCOPE,
};

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
  /** Per-page period-over-period intelligence (see buildPageInsights). */
  pageInsights: PageInsight[];
  /** Daily clicks for the top pages (trend sparklines, capped server-side). */
  pageTrends: Array<{ url: string; date: string; clicks: number }>;
  /** Sitemap submitted-vs-indexed coverage, null when the account lists no sitemaps. */
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
  /** One next step, or null when there is nothing to do. */
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
