/**
 * Types for the discovery / company-context module.
 *
 * Two vocabularies meet in this file and must not be confused:
 *
 * 1. **The pipeline's working vocabulary** — `PageType`, `PurposeCategory`,
 *    `FactField`, `DraftFact` — ported from the old repo's
 *    `aeo-context.service.ts`, where page types are lowercase (`case-study`).
 * 2. **The spec doc's output vocabulary** — {@link CompanyContextProfileJson},
 *    the "Final Enriched Company-Context Schema" a later module reads. Every
 *    material field there is an evidence-bearing object, never a bare string.
 *
 * The mapping helpers at the bottom translate the first into the Prisma enums
 * the rows actually store.
 */

import type { PageType as PrismaPageType } from '../../generated/prisma/enums.js';

// ─── Page taxonomy ──────────────────────────────────────────────────────────

/**
 * The shipped code's proven page classes — deliberately **not** the spec doc's
 * 29-class list, which was never implemented or tuned. The doc's extra classes
 * fold into the closest existing one (see docs/analysis/discovery.md "Page
 * classification taxonomy"): `product`/`solution`/`use_case` → `service`,
 * `testimonial`/`customer` → `case-study`, `documentation`/`resource`/
 * `integration`/`compliance` → `other`, `investor_relations` → `press`.
 */
export type PageType =
  | 'homepage'
  | 'service'
  | 'about'
  | 'pricing'
  | 'industries'
  | 'location'
  | 'case-study'
  | 'blog'
  | 'login'
  | 'cart'
  | 'policy'
  | 'leadership'
  | 'security'
  | 'press'
  | 'careers'
  | 'partner'
  | 'other';

/**
 * Purpose categories the select stage reserves coverage capacity for. The
 * always-excluded classes (`login`, `cart`, `policy`, `blog`) are not in this
 * union at all — they can never be selected, so representing them here would
 * only invite a bug where one gets a coverage slot.
 */
export type PurposeCategory = Exclude<PageType, 'login' | 'cart' | 'policy' | 'blog'>;

/** Purpose category → the Prisma enum member the page row stores. */
export const PAGE_TYPE_TO_PRISMA: Record<PageType, PrismaPageType> = {
  homepage: 'HOMEPAGE',
  service: 'SERVICE',
  about: 'ABOUT',
  pricing: 'PRICING',
  industries: 'INDUSTRIES',
  location: 'LOCATION',
  'case-study': 'CASE_STUDY',
  leadership: 'LEADERSHIP',
  security: 'SECURITY',
  press: 'PRESS',
  careers: 'CAREERS',
  partner: 'PARTNER',
  blog: 'BLOG',
  other: 'OTHER',
  cart: 'CART',
  login: 'LOGIN',
  policy: 'POLICY',
};

export const PRISMA_TO_PAGE_TYPE: Record<PrismaPageType, PageType> = Object.fromEntries(
  Object.entries(PAGE_TYPE_TO_PRISMA).map(([working, stored]) => [stored, working as PageType]),
) as Record<PrismaPageType, PageType>;

// ─── Facts ──────────────────────────────────────────────────────────────────

/**
 * Business-fact fields a fact can carry (site-context-v2 §11, expanded from the
 * pre-v2 10). This is the pipeline's internal field vocabulary; the spec doc's
 * nested `profile_json` sections are assembled from these at compile time.
 */
export type FactField =
  | 'services'
  | 'icp'
  | 'valueProps'
  | 'painPoints'
  | 'outcomes'
  | 'markets'
  | 'category'
  | 'vertical'
  | 'description'
  | 'brand'
  | 'legalName'
  | 'alternateName'
  | 'foundedYear'
  | 'headquarters'
  | 'officeLocation'
  | 'languages'
  | 'pricingModel'
  | 'differentiator'
  | 'leadership'
  | 'certification'
  | 'award'
  | 'partner'
  | 'technology'
  | 'businessModel'
  | 'contact';

/** How a fact was arrived at (§13) — never trust the model's self-reported confidence alone. */
export type FactType = 'explicit' | 'strong_inference' | 'weak_inference' | 'conflicted';

/** One JSON-LD entity kept as evidence (§9) — the raw block, not inferred truth. */
export interface JsonLdEntity {
  type: string;
  fields: Record<string, unknown>;
}

/**
 * One extraction-stage fact before the reconcile stage touches it.
 *
 * `excerpt` is kept **verbatim** — the validate stage checks it back against
 * the cited page's stored content, so anything normalized here would fail its
 * own validation. `contentHash` is the fingerprint of the page it came from.
 */
export interface DraftFact {
  field: FactField;
  value: string;
  sourceUrl: string;
  excerpt: string | null;
  contentHash: string | null;
  factType?: FactType;
  /** Set on facts found by bounded search rather than first-party extraction. */
  sourceType?: SourceType;
}

/**
 * A fact after reconcile/validate: one value per field-claim, carrying every
 * source that supports it, its computed confidence, and whether validate
 * accepted it.
 */
export interface ReconciledFact {
  field: FactField;
  value: string;
  factType: FactType;
  confidence: number;
  /** Every source supporting this value (deduped by URL). */
  sources: FactSource[];
  sourceType: SourceType;
  /** False when the validate stage could not find the excerpt verbatim in the cited page. */
  validated: boolean;
  validationNote: string | null;
  /** Set by the consolidate stage — which category this value was summarised into. */
  category?: string;
}

/** Where one fact came from — the unit the evidence format is built from. */
export interface FactSource {
  url: string;
  /** The page's classified type, or `null` for a search result that was never crawled. */
  pageType: PageType | null;
  excerpt: string | null;
  /** ISO-8601 — when the page was fetched. */
  fetchedAt: string;
  contentHash: string | null;
}

/** First-party pages vs. anything found by the bounded external search pass. */
export type SourceType = 'first_party' | 'external';

// ─── Evidence-bearing output (spec doc schema) ──────────────────────────────

/**
 * One quote backing one fact. `source_id` points into the profile's top-level
 * `sources[]` registry, which is what makes a claim traceable back to a page
 * (and its fetch date and content hash) without repeating the page metadata on
 * every field.
 */
export interface EvidenceItem {
  evidence_id: string;
  source_id: string;
  source_url: string;
  source_type: SourceType;
  page_type: string;
  quote: string;
  published_at: string | null;
  fetched_at: string;
}

/**
 * The spec doc's evidence-bearing field format — used for *every* material
 * field in `profile_json`, scalar or array. `status: 'stale'` is how a fact
 * that no longer holds is marked; these tables are append-only and a new run
 * supersedes the old row, so a stale fact is never deleted (see
 * docs/analysis/discovery.md "Soft-delete exception").
 */
export interface FactValue {
  fact_id: string;
  value: string;
  status: 'supported' | 'stale' | 'unverified';
  fact_type: FactType;
  confidence: number;
  last_checked_at: string;
  evidence_ids: string[];
  evidence: EvidenceItem[];
}

/** A scalar field: exactly one evidence-bearing value, or none. */
export type ScalarField = FactValue | null;
/** An array field: zero or more evidence-bearing values. */
export type ArrayField = FactValue[];

/** The top-level source registry — one entry per crawled page or search source. */
export interface SourceRegistryEntry {
  source_id: string;
  url: string;
  title: string | null;
  source_type: SourceType;
  page_type: string;
  publisher: string | null;
  published_at: string | null;
  fetched_at: string;
  content_hash: string | null;
  accessible: boolean;
}

/** A place two facts (or two sources) genuinely disagree. */
export interface ProfileConflict {
  field: string;
  values: string[];
  note: string;
}

/** A field the pipeline expected to fill and could not. */
export interface MissingFieldEntry {
  field: string;
  category: string;
  note: string | null;
}

export interface ProfileResearchMetadata {
  started_at: string;
  completed_at: string;
  last_verified_at: string | null;
  pages_discovered: number;
  pages_fetched: number;
  pages_analyzed: number;
  external_queries_run: number;
  overall_confidence: number;
  overall_completeness: number;
  /** Matches `company_context_profiles.version` / `discovery_runs.profile_version`. */
  profile_version: string;
}

/**
 * The Final Enriched Company-Context Schema (spec doc step 23) — the shape of
 * `company_context_profiles.profile_json`.
 *
 * Section names, field names and nesting are taken verbatim from the doc. The
 * doc's own design principle applies throughout: fields are evidence-bearing
 * objects rather than bare scalars, so an empty section is `null`/`[]`, never a
 * made-up string.
 */
export interface CompanyContextProfileJson {
  identity: {
    business_name: ScalarField;
    legal_name: ScalarField;
    alternate_names: ArrayField;
    brands: ArrayField;
    company_type: ScalarField;
    parent_company: ScalarField;
    subsidiaries: ArrayField;
    founded_year: ScalarField;
    primary_domain: ScalarField;
    related_domains: ArrayField;
    logo_url: ScalarField;
  };
  descriptions: {
    one_line: ScalarField;
    short: ScalarField;
    detailed: ScalarField;
  };
  offerings: {
    products: ArrayField;
    services: ArrayField;
    solutions: ArrayField;
    packages: ArrayField;
    delivery_model: ScalarField;
    pricing_model: ScalarField;
    pricing_details: ArrayField;
    free_trial: ScalarField;
    demo_available: ScalarField;
  };
  positioning: {
    value_propositions: ArrayField;
    differentiators: ArrayField;
    problems_solved: ArrayField;
    outcomes_promised: ArrayField;
    key_messages: ArrayField;
    claims_and_proof: ArrayField;
  };
  customers: {
    icp_summary: ScalarField;
    company_sizes: ArrayField;
    industries: ArrayField;
    buyer_roles: ArrayField;
    user_roles: ArrayField;
    use_cases: ArrayField;
    named_customers: ArrayField;
    customer_examples: ArrayField;
  };
  geography: {
    headquarters: ScalarField;
    offices: ArrayField;
    service_areas: ArrayField;
    countries: ArrayField;
    regions: ArrayField;
    languages: ArrayField;
    remote_or_local_delivery: ScalarField;
  };
  go_to_market: {
    business_model: ScalarField;
    sales_motion: ScalarField;
    self_serve: ScalarField;
    primary_ctas: ArrayField;
    distribution_channels: ArrayField;
    partners: ArrayField;
    marketplaces: ArrayField;
  };
  credibility: {
    case_studies: ArrayField;
    testimonials: ArrayField;
    awards: ArrayField;
    certifications: ArrayField;
    security_and_compliance: ArrayField;
    review_profiles: ArrayField;
    ratings: ArrayField;
  };
  organization: {
    founders: ArrayField;
    leadership: ArrayField;
    team_members: ArrayField;
    team_size: ScalarField;
    hiring_areas: ArrayField;
    contact_details: ArrayField;
  };
  digital_presence: {
    social_profiles: ArrayField;
    app_profiles: ArrayField;
    developer_profiles: ArrayField;
    content_channels: ArrayField;
    community_links: ArrayField;
  };
  technology: {
    integrations: ArrayField;
    platforms_supported: ArrayField;
    api_available: ScalarField;
    technology_signals: ArrayField;
  };
  sources: SourceRegistryEntry[];
  conflicts: ProfileConflict[];
  missing_fields: MissingFieldEntry[];
  research_metadata: ProfileResearchMetadata;
}

/** One category's consolidated summary, as the consolidate stage produces it. */
export interface CategorySummary {
  category: string;
  /** The summary text (may be empty when the category had no facts — no LLM call is spent on those). */
  summary: string;
  /**
   * The category's **canonical value list**: the same values as the input facts,
   * copied verbatim, with semantic duplicates merged and non-values removed
   * (a marketing slogan is not an offering, a customer's testimonial is not the
   * company's claim).
   *
   * Consolidation is the only stage that sees every value for a field at once,
   * so it is the only place that can do this — a per-page extraction pass cannot
   * know that "emails landing in spam folder" and "emails landing in spam" are
   * one claim. Compile uses this list to filter the facts it assembles the
   * profile from; values are never reworded, which is what keeps every surviving
   * value traceable to its evidence.
   */
  facts: string[];
  /** Fields consolidate reported as having zero facts. */
  missingFields: FactField[];
  /** Human-readable notes for each real conflict consolidate found. */
  conflictNotes: string[];
}

// ─── Social profiles ────────────────────────────────────────────────────────

/** How a profile was found — mirrors the `ProfileDiscoveryMethod` Prisma enum. */
export type SocialDiscoveryMethod = 'same-as' | 'link-scan' | 'serp';

export const SOCIAL_METHOD_TO_PRISMA = {
  'same-as': 'SAMEAS',
  'link-scan': 'LINK_SCAN',
  serp: 'SERP',
} as const;

/** Mirrors the `SocialVerificationStatus` Prisma enum, in the spec doc's own words. */
export type SocialStatus = 'verified' | 'probable' | 'possible' | 'rejected';

export const SOCIAL_STATUS_TO_PRISMA = {
  verified: 'VERIFIED',
  probable: 'PROBABLE',
  possible: 'POSSIBLE',
  rejected: 'REJECTED',
} as const;

/** A scored candidate, ready to persist (or reject — rejected rows are not stored). */
export interface ScoredSocialProfile {
  platform: string;
  url: string;
  discoveryMethod: SocialDiscoveryMethod;
  /** Point-table score, or null when the platform is walled and nothing beyond the link signal was checkable. */
  score: number | null;
  status: SocialStatus;
  /** The platform blocks logged-out fetches, so no fetch-derived signal was available. */
  walled: boolean;
  /** Which signals fired, for the run's notes and for debugging a wrong verdict. */
  signals: string[];
}

// ─── Pipeline working state (persisted in the `pipeline_state` columns) ─────

/** Per-page state kept on `discovered_pages.pipeline_state`. */
export interface PagePipelineState {
  /** How the discover stage reached this URL (`homepage`, `sitemap`, `homepage-links`, `guess`). */
  discoverySource?: string;
  /** HTTP status seen when the page was fetched, when the fetch path reported one. */
  statusCode?: number | null;
  /** ISO-8601 — when the page was fetched, used as `FactSource.fetchedAt`. */
  fetchedAt?: string | null;
  /** Inspect-stage output — absent until the inspect stage has run for this page. */
  title?: string | null;
  description?: string | null;
  headings?: string[];
  language?: string | null;
  /**
   * Candidate service names / value propositions, DOM-filtered at fetch time
   * (heading level, card/tile structure, and the team/testimonial ancestor
   * check) because the cleaned text alone cannot tell those apart. The extract
   * stage applies the page-type gate and nothing else.
   */
  serviceCandidates?: string[];
  valuePropCandidates?: string[];
  /** Select-stage verdict: whether this page filled a coverage slot, and why. */
  selected?: boolean;
  selectionReason?: string | null;
  purposeCategory?: string | null;
  /** Extract-stage progress for this page. */
  extractStatus?: 'pending' | 'done' | 'failed';
  extractError?: string | null;
  retryCount?: number;
  /** This page's extracted facts — kept per page so a retry re-spends nothing already paid for. */
  facts?: DraftFact[];
  /** The page's JSON-LD entities, as extracted at inspect time. */
  jsonLd?: JsonLdEntity[];
}

/** Run-level state kept on `discovery_runs.pipeline_state`. */
export interface RunPipelineState {
  /** Budgets this run was created with — fixed at creation so a re-enqueue cannot silently widen them. */
  budgets?: {
    maxPages: number;
    maxRequests: number;
    maxChars: number;
    maxElapsedMs: number;
    maxRetriesPerPage: number;
  };
  /** Stage the run is currently inside (distinct from the last *completed* stage on the row). */
  currentStage?: string;
  /** Reconcile's merged output, carried into validate → consolidate → compile. */
  facts?: ReconciledFact[];
  /** Category summaries from consolidate, refreshed once after gap research. */
  summaries?: CategorySummary[];
  /** The select stage's coverage plan, for the run notes and debugging. */
  coveragePlan?: Record<string, { target: number; filled: number }>;
  /** Pages inspected/fetched/analyzed counts, for `research_metadata`. */
  stats?: {
    pagesDiscovered?: number;
    pagesFetched?: number;
    pagesAnalyzed?: number;
  };
  /** Bounded-search spend, so a re-enqueued job cannot exceed the documented caps. */
  search?: {
    queriesRun: number;
    costUsd: number;
    fieldsSearched: string[];
  };
  /** Social discovery's found-but-unscored candidates, before the scoring pass. */
  socialCandidates?: Array<{
    platform: string;
    url: string;
    discoveryMethod: string;
  }>;
}

/** A run row's `pipeline_state` is always an object — read it through this. */
export function readRunState(value: unknown): RunPipelineState {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RunPipelineState) : {};
}

/** A page row's `pipeline_state` is always an object — read it through this. */
export function readPageState(value: unknown): PagePipelineState {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as PagePipelineState) : {};
}
