/**
 * Competitors module vocabulary.
 *
 * @module competitors/competitors.types
 */

export type TechCategory = 'analytics' | 'ads' | 'crm' | 'chat' | 'cms' | 'hosting' | 'cdn' | 'ecommerce' | 'tag-manager' | 'ab-testing';

/**
 * One detectable technology. A signature matches when ANY of its defined
 * fields matches its corresponding signal — `headers` is tested against
 * every header value (not just one named key), the rest against the named
 * extracted string. Ported from the old repo's `tech-stack.signatures.ts`.
 */
export interface TechSignature {
  category: TechCategory;
  name: string;
  headers?: RegExp[];
  html?: RegExp;
  scriptSrc?: RegExp;
  generator?: RegExp;
}

export interface TechStackFinding {
  category: TechCategory;
  name: string;
  evidence: string[];
}

export interface ReviewRating {
  source: string;
  rating: number;
  count: number | null;
}

export type FetchStatus = 'OK' | 'FAILED';

/** One domain's full profile — the shape persisted as one `CompetitorProfile` row. */
export interface DomainProfile {
  techStackFindings: TechStackFinding[];
  schemaTypes: string[];
  seoScore: number | null;
  seoIssues: string[];
  reviewRating: ReviewRating | null;
  fetchStatus: FetchStatus;
  error: string | null;
}
