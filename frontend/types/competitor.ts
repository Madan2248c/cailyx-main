/**
 * Competitors tab types — a thin mirror of the backend competitors module.
 * Reads only; tracking writes reuse the onboarding endpoints
 * (lib/onboarding-api.ts patchCompetitor/addCompetitor).
 */

import type { CompetitorStanding } from '@/types/aeo';

export interface TechStackFinding {
  category: string;
  name: string;
  evidence: string[];
}

export interface ReviewRating {
  source: string;
  rating: number;
  count: number | null;
}

/** The deterministic per-domain summary from getGap(). */
export interface GapProfile {
  techStackFindings: unknown;
  schemaTypes: unknown;
  seoScore: number | null;
  seoIssues: unknown;
  reviewRating: unknown;
  fetchStatus: string;
}

/** One row of the gap comparison — the client's own domain has competitorId null. */
export interface GapRow {
  competitorId: string | null;
  name: string;
  domain: string | null;
  profile: GapProfile | null;
  aeoStanding: CompetitorStanding | null;
}

export interface GapResponse {
  own: GapRow;
  competitors: GapRow[];
}

/** One competitor row with its latest persisted profile (GET …/competitors). */
export interface CompetitorProfileRow {
  techStackFindings: unknown;
  schemaTypes: unknown;
  seoScore: number | null;
  seoIssues: unknown;
  reviewRating: unknown;
  fetchStatus: string;
}

export interface CompetitorWithProfile {
  id: string;
  projectId: string;
  name: string;
  domain: string | null;
  status: 'tracked' | 'candidate';
  source: string;
  latestProfile: CompetitorProfileRow | null;
}
