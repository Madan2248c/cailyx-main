/**
 * Onboarding types — a thin mirror of the backend's evidence-bearing
 * profile shape. The wizard only reads `.value` strings and writes them
 * back; fact ids, confidence, and evidence stay server-side.
 */

export interface FactValue {
  fact_id: string;
  value: string;
  status: 'supported' | 'stale' | 'unverified';
  confidence: number;
}

export type ScalarField = FactValue | null;
export type ArrayField = FactValue[];

/** `profile_json` sections: `Record<section, Record<field, ScalarField | ArrayField>>`. */
export type CompanyProfile = Record<string, Record<string, ScalarField | ArrayField | unknown>>;

export interface CompanyContextResponse {
  id: string;
  projectId: string;
  discoveryRunId: string;
  version: number;
  overallConfidence: number | null;
  overallCompleteness: number | null;
  profile: CompanyProfile;
  createdAt: string;
  updatedAt: string;
}

export interface SocialProfile {
  id: string;
  projectId: string;
  platform: string;
  url: string;
  discoveryMethod: string;
  score: number | null;
  verificationStatus: 'VERIFIED' | 'PROBABLE' | 'POSSIBLE' | 'REJECTED';
  verifiedAt: string | null;
}

export interface Competitor {
  id: string;
  name: string;
  domain: string | null;
  status: 'tracked' | 'candidate';
  source: string;
}

/** One `section.field` edit: string (scalar), string[] (array), null (clear). */
export type ProfileFieldUpdates = Record<string, string | string[] | null>;

function isFactValue(raw: unknown): raw is FactValue {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as { value?: unknown }).value === 'string'
  );
}

/** The display string for a scalar field, or '' when missing. */
export function scalarOf(profile: CompanyProfile, section: string, field: string): string {
  const raw = profile[section]?.[field];
  return isFactValue(raw) ? raw.value : '';
}

/** The display strings for an array field, or [] when missing. */
export function arrayOf(profile: CompanyProfile, section: string, field: string): string[] {
  const raw = profile[section]?.[field];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isFactValue).map((f) => f.value);
}
