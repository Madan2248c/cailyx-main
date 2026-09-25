import type { FactField, FactType, PageType, PurposeCategory } from './discovery.types.js';

/**
 * Tuned constants for the discovery pipeline — every threshold, pattern and
 * coverage target the stages use.
 *
 * Ported verbatim from the old repo's `aeo-audit/aeo-context.service.ts`
 * (its constants block, lines 54–214), which is the shipped, battle-tested
 * implementation of this pipeline. Per docs/analysis/discovery.md, where the
 * spec doc and that code disagree, **the code's tuned numbers win** — so the
 * values in this file are deliberately not "cleaned up" or re-derived. If a
 * number here changes, it should be because a real run showed it was wrong.
 *
 * The one exception is {@link CATEGORY_WEIGHTS}, which the spec doc proposed
 * and the old code implemented inline; see its own docblock.
 */

/** Path fragments that usually carry offer/ICP language, best first. */
export const HIGH_SIGNAL_PATHS = [
  '/services',
  '/solutions',
  '/what-we-do',
  '/products',
  '/pricing',
  '/industries',
  '/who-we-serve',
  '/about',
  '/case-studies',
  '/use-cases',
] as const;

/**
 * Same idea, but matched against sitemap URLs we actually found. Broad on
 * purpose — this only ranks candidates, it never excludes anything, so it can
 * afford to cover consumer/e-commerce sites too, not just B2B/SaaS.
 */
export const HIGH_SIGNAL_PATTERNS =
  /\/(services?|solutions?|products?|pricing|plans|industr(y|ies)|use-cases?|what-we-do|who-we-serve|capabilities|expertise|sectors?|about|faq|how-it-works|reviews?|testimonials?)(\/|$)/i;

/** Nav/footer noise that is never a service name. */
export const NAV_NOISE =
  /^(home|about( us)?|contact( us)?|blog|news|careers?|jobs|login|log ?in|sign ?(in|up)|privacy|terms|cookies?|sitemap|faq|support|help|search|menu|close|back to top|all rights reserved|subscribe|newsletter|follow us|get started|book a (call|demo)|read more|learn more|our team|team|press|partners?)$/i;

/**
 * Single words that are pricing tiers, plan names or process-step labels rather
 * than offerings. "companies that do Starter" is not a query anyone types.
 */
export const TIER_AND_STEP_WORDS =
  /^(starter|basic|standard|premium|pro|plus|growth|scale|enterprise|business|free|trial|custom|lite|advanced|essential|team|agency|diagnose|discover|build|operate|compound|deliver|launch|plan|design|measure|optimi[sz]e|onboard|scoping?|audit|strategy|execution|results?|process|approach|method|phase|step|one|two|three)$/i;

/**
 * E-commerce/catalog browse-and-merchandising section headers — "Shop by
 * Category", "Trending Brands", "New Arrivals" are how a storefront organizes
 * its own catalog, never a thing a buyer asks "who provides X" about. Without
 * this, every consumer/retail site's nav chrome gets read as a services list.
 */
export const MERCHANDISING_NOISE =
  /^(shop by|browse (by|all)|explore (by|all)|trending|popular|featured|curated|new arrivals?|newly added|best[- ]?sellers?|top[- ]?(picks|rated|sellers?)|recommended( for you)?|see all|view all|all (brands?|products?|categories))\b/i;

// ─── Page-type patterns (used by the classify step of the inspect stage) ─────

export const CART_PATTERN = /\/(cart|checkout)(\/|$)/i;
export const LOGIN_PATTERN = /\/(login|log-in|signin|sign-in|register|account|my-account|search)(\/|$)/i;
export const POLICY_PATTERN = /\/(privacy|terms|cookie|cookies|legal|gdpr)(\/|$)/i;
export const PRICING_PATTERN = /\/(pricing|plans)(\/|$)/i;
export const ABOUT_PATTERN = /\/about/i;
export const INDUSTRIES_PATTERN = /\/(industr(y|ies)|sectors?|who-we-serve)(\/|$)/i;
export const LOCATION_PATTERN = /\/(locations?|near-me|cities|areas?-we-serve|service-areas?)(\/|$)/i;
export const CASE_STUDY_PATTERN = /\/(case-stud(y|ies)|success-stor(y|ies)|customer-stor(y|ies)|testimonials?)(\/|$)/i;
export const SERVICE_PATTERN = /\/(services?|solutions?|products?|what-we-do|capabilit|expertise)(\/|$)/i;
export const BLOG_PATTERN = /\/(blog|news|articles?|insights?)(\/|$)/i;
/** Site-context-v2 §5 — additional classes the pre-v2 pipeline collapsed into "other". */
export const LEADERSHIP_PATTERN = /\/(leadership|team|our-team|management|founders?)(\/|$)/i;
export const SECURITY_PATTERN = /\/(security|compliance|trust|gdpr-compliance|soc2|iso-27001)(\/|$)/i;
export const PRESS_PATTERN = /\/(press|newsroom|media-kit|investors?|investor-relations)(\/|$)/i;
export const CAREERS_PATTERN = /\/(careers?|jobs|join-us|we're-hiring|hiring)(\/|$)/i;
export const PARTNER_PATTERN = /\/(partners?|integrations?|marketplace|ecosystem)(\/|$)/i;

// ─── Budgets ────────────────────────────────────────────────────────────────
//
// Defaults are the old code's, read from env there and from env here
// (`DISCOVERY_*`) so a live end-to-end run can be widened without a code change.

export const DEFAULT_MAX_PAGES = 12;
export const DEFAULT_MAX_REQUESTS = 40;
export const DEFAULT_MAX_CHARS = 24_000;
/** Elapsed wall-clock per job, not per run — a re-enqueued continuation gets this much again. */
export const DEFAULT_MAX_ELAPSED_MS = 300_000;
export const DEFAULT_MAX_RETRIES_PER_PAGE = 2;

/** Cap on cached page content (keeps page rows bounded on a large page). */
export const MAX_CACHED_TEXT = 30_000;
/** Cap on the raw JSON-LD blocks kept per page — small, but never unbounded. */
export const MAX_JSON_LD_RAW = 20_000;
/** Cap on characters of page text handed to any one LLM extraction batch call. */
export const MAX_BATCH_CHARS = 8_000;
/** Pages per LLM extraction batch. */
export const EXTRACT_BATCH_SIZE = 4;

// ─── Discovery (crawl) budgets and caps ─────────────────────────────────────

export const MAX_SITEMAP_FILES = 50;
export const MAX_SITEMAP_DEPTH = 4;
/** Per parent-path "template" — so one large archive can't crowd out everything else. */
export const SAMPLES_PER_TEMPLATE = 2;
/** Hard cap on the candidate list the discover stage returns. */
export const DISCOVERY_URL_CAP = 20;
export const HOMEPAGE_NAV_LINK_CAP = 15;
export const HOMEPAGE_ALL_LINK_CAP = 40;
/** Cap on headings kept per page by the inspect stage. */
export const MAX_HEADINGS_PER_PAGE = 20;
/** Cap on JSON-LD entities kept per page. */
export const MAX_JSON_LD_ENTITIES_PER_PAGE = 30;

/**
 * Sitemap entry points tried in order, but only when robots.txt named none —
 * the first entry point that yields anything wins, so this is not a list we
 * read in full.
 */
export const SITEMAP_ENTRY_POINTS = [
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/sitemap-index.xml',
  '/wp-sitemap.xml',
  '/sitemap/sitemap.xml',
] as const;

// ─── Coverage targets (select stage) ────────────────────────────────────────

/** How many of the fetched pool the select stage will take per category, priority order first. */
export const CATEGORY_TARGETS: Record<PurposeCategory, number> = {
  homepage: 1,
  service: 4,
  pricing: 1,
  about: 1,
  industries: 2,
  location: 1,
  'case-study': 2,
  leadership: 1,
  security: 1,
  press: 1,
  careers: 1,
  partner: 1,
  other: 1,
};

export const CATEGORY_PRIORITY: PurposeCategory[] = [
  'homepage',
  'service',
  'pricing',
  'about',
  'industries',
  'location',
  'case-study',
  'leadership',
  'security',
  'partner',
  'press',
  'careers',
  'other',
];

// ─── Extraction ─────────────────────────────────────────────────────────────

/**
 * The fixed field list the LLM extraction pass is allowed to produce (the
 * spec doc's 23 fields). Anything not on this list is dropped rather than
 * kept as an untyped extra.
 */
export const EXTRACTION_FIELDS: FactField[] = [
  'services',
  'icp',
  'valueProps',
  'painPoints',
  'outcomes',
  'markets',
  'category',
  'vertical',
  'description',
  'legalName',
  'alternateName',
  'foundedYear',
  'headquarters',
  'officeLocation',
  'languages',
  'pricingModel',
  'differentiator',
  'leadership',
  'certification',
  'award',
  'partner',
  'technology',
  'businessModel',
  'contact',
];

/** JSON-LD fields worth keeping (site-context-v2 §9) — everything else on the block is dropped. */
export const JSON_LD_FIELDS = [
  'name',
  'legalName',
  'alternateName',
  'description',
  'url',
  'logo',
  'sameAs',
  'address',
  'areaServed',
  'contactPoint',
  'founder',
  'foundingDate',
  'parentOrganization',
  'subOrganization',
  'brand',
  'makesOffer',
  'offers',
  'knowsAbout',
  'award',
  'slogan',
  'telephone',
  'email',
] as const;

/** Schema.org types worth extracting identity/geography/organization facts from. */
export const RELEVANT_JSON_LD_TYPES = new Set([
  'Organization',
  'Corporation',
  'LocalBusiness',
  'ProfessionalService',
  'Brand',
  'WebSite',
  'Product',
  'Service',
  'Offer',
  'AggregateOffer',
  'SoftwareApplication',
  'Person',
  'Place',
  'PostalAddress',
  'ContactPoint',
  'FAQPage',
  'Review',
  'AggregateRating',
]);

/**
 * Which fact fields each `profile_json` category is expected to carry. Used
 * twice: the consolidate stage summarises one category at a time from exactly
 * these fields, and the compile stage scores a category's completeness as
 * `1 − missingFields.length / totalExpectedFieldsForCategory`.
 *
 * The category names are the spec doc's own top-level keys, and they happen to
 * be the same 10 names the old code's `CATEGORY_FIELDS` used — which is what
 * lets the code's consolidation logic be kept verbatim while still producing
 * the doc's schema.
 */
export const CATEGORY_FIELDS: Record<string, FactField[]> = {
  identity: ['brand', 'legalName', 'alternateName', 'foundedYear', 'category', 'vertical'],
  descriptions: ['description'],
  offerings: ['services', 'pricingModel'],
  positioning: ['valueProps', 'differentiator', 'painPoints', 'outcomes'],
  customers: ['icp'],
  geography: ['markets', 'headquarters', 'officeLocation', 'languages'],
  organization: ['leadership'],
  credibility: ['certification', 'award'],
  go_to_market: ['businessModel', 'partner', 'contact'],
  technology: ['technology'],
};

/** `digital_presence` is scored separately (binary — see {@link DIGITAL_PRESENCE_WEIGHT}). */
export const DIGITAL_PRESENCE_CATEGORY = 'digital_presence';

/**
 * Category weights for the overall completeness score (sums to 1.00).
 *
 * These are the old code's **tuned** weights, not the spec doc's proposed ones
 * (the doc gave `digital_presence` 10% and no separate `descriptions`
 * category). Per docs/analysis/discovery.md, the tuned numbers win — they were
 * fitted against real sites; the doc's were a proposal.
 */
export const CATEGORY_WEIGHTS: Record<string, number> = {
  identity: 0.15,
  descriptions: 0.05,
  offerings: 0.15,
  positioning: 0.1,
  customers: 0.15,
  geography: 0.1,
  organization: 0.05,
  credibility: 0.1,
  go_to_market: 0.05,
  technology: 0.05,
  [DIGITAL_PRESENCE_CATEGORY]: 0.05,
};

/**
 * `digital_presence` completeness is binary — 1 when any verified-or-better
 * social profile exists, else 0. A partial social footprint is not "60%
 * present": either we can point at the company's own account or we cannot.
 */
export const DIGITAL_PRESENCE_PRESENT = 1;
export const DIGITAL_PRESENCE_ABSENT = 0;

/**
 * Definition-of-Done gate (spec doc, step 23): below this identity confidence
 * the run completes `MANUAL_REVIEW_REQUIRED` rather than `COMPLETE`, because
 * every later module keys off the identity it resolved.
 */
export const IDENTITY_CONFIDENCE_FLOOR = 0.8;

/**
 * Second Definition-of-Done gate: the run needs this share of the selected
 * pages actually analyzed, or it completes `COMPLETE_WITH_GAPS`.
 */
export const REACHABLE_PAGES_FLOOR = 0.8;

// ─── Reconciliation (confidence formula) ────────────────────────────────────

/** Base confidence by how the fact was arrived at — never the model's self-report. */
export const FACT_TYPE_BASE: Record<FactType, number> = {
  explicit: 0.75,
  strong_inference: 0.55,
  weak_inference: 0.35,
  conflicted: 0.3,
};

/** Page types authoritative enough to lift a fact's confidence. */
export const AUTHORITY_BOOST_PAGE_TYPES = new Set<PageType>([
  'homepage',
  'about',
  'pricing',
  'leadership',
  'security',
]);
export const AUTHORITY_BOOST = 0.1;
/** Per additional corroborating source, and its cap. */
export const CORROBORATION_BOOST_PER_SOURCE = 0.05;
export const CORROBORATION_BOOST_MAX_SOURCES = 2;

/**
 * Multi-value fields whose values consolidate's canonical list is allowed to
 * filter before compile assembles them.
 *
 * Deliberately **not** every field. These are the ones where a page can produce
 * many near-duplicate or non-value entries (headings on a marketing page are
 * slogans as often as they are offerings), so a list-level clean-up is worth
 * trusting. Identity fields (`brand`, `legalName`, `category`, `foundedYear`,
 * …) stay out: they hold one value each, noise there is a *conflict* to report
 * rather than a list to prune, and silently dropping one would cost the profile
 * its identity.
 */
export const CANONICAL_VALUE_FIELDS = new Set<FactField>([
  'services',
  'valueProps',
  'painPoints',
  'outcomes',
  'differentiator',
  'technology',
  'certification',
  'partner',
  'award',
  'icp',
  'markets',
  'contact',
  'languages',
  'leadership',
]);

/**
 * How many values one value-judgement call may carry per category. Bounds the
 * prompt for a run that extracted a lot (a 12-page crawl can produce dozens of
 * candidate services); values past the cap are simply not judged, which — like
 * a missing verdict — means they are kept.
 */
export const VALUE_JUDGEMENT_CAP = 40;

/**
 * Fields where exactly one value can be true — two different values means we
 * mark them all `conflicted` rather than silently picking one.
 */
export const SINGULAR_FIELDS = new Set<FactField>([
  'category',
  'vertical',
  'description',
  'brand',
  'legalName',
  'foundedYear',
]);

/** External (search-sourced) facts are never treated as equal to a first-party explicit fact. */
export const EXTERNAL_FACT_CONFIDENCE_CAP = 0.6;

// ─── Bounded search (external enrichment + gap research) ────────────────────

/** Fields external enrichment targets when they have no first-party fact at all. */
export const EXTERNAL_ENRICHMENT_FIELDS: FactField[] = [
  'headquarters',
  'foundedYear',
  'leadership',
  'certification',
  'award',
];
export const SEARCHES_PER_FIELD = 2;
export const RESULTS_PER_SEARCH = 3;
/** Gap research targets only what consolidate flagged, deduped, capped here. */
export const GAP_RESEARCH_MAX_FIELDS = 5;

// ─── Social profiles ────────────────────────────────────────────────────────

/**
 * Platforms that block logged-out automated requests. We never fetch these, so
 * a walled profile can only ever earn the "official site links to it" signal —
 * which honestly caps it at `probable`/`possible`, never `verified`. Ported
 * from the old repo's `entity-audit.service.ts` `WALLED_HOSTS`.
 */
export const WALLED_HOSTS = new Set([
  'instagram.com',
  'instagr.am',
  'facebook.com',
  'fb.com',
  'fb.me',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'threads.net',
  'threads.com',
  'g2.com',
  'crunchbase.com',
  'glassdoor.com',
]);

/**
 * The spec doc's verification point table (step 16), restricted to signals a
 * fetch can actually produce — the doc's image-comparison and industry-match
 * signals are not implementable without asset comparison, and are omitted
 * rather than stubbed. See docs/analysis/discovery.md "Social profile
 * verification" for which signals survive per platform type.
 */
export const SOCIAL_SIGNALS = {
  /** Official website links to the profile. The only signal a walled platform can earn. */
  OFFICIAL_SITE_LINKS: 45,
  /** Profile links back to the exact company domain (needs a fetch). */
  LINKS_BACK_TO_DOMAIN: 40,
  /** Profile title/bio matches the company or brand name (needs a fetch). */
  NAME_MATCH: 20,
  /** Matching location (needs a fetch). */
  LOCATION_MATCH: 10,
  /** Active, business-oriented profile (needs a fetch). */
  ACTIVE_BUSINESS_PROFILE: 5,
  /** Generic or ambiguous name — a negative signal, not a missing one. */
  GENERIC_NAME: -15,
  /** A different company's domain in the profile bio (needs a fetch). */
  DIFFERENT_DOMAIN: -40,
} as const;

/** Spec doc step 16 status bands. */
export const SOCIAL_STATUS_BANDS = {
  VERIFIED: 80,
  PROBABLE: 60,
  POSSIBLE: 40,
} as const;

/** Above this 0–1 name similarity, a SERP candidate is worth verifying further. */
export const SERP_NAME_SIMILARITY_FLOOR = 0.6;

// ─── Stage order ────────────────────────────────────────────────────────────

/**
 * The exact stage order, from the shipped code. The processor walks this list,
 * skipping stages already completed on a prior job and checkpointing
 * `discovery_runs.stage` after each one — so this order *is* the resume
 * contract: inserting a stage here changes what a paused run resumes into.
 */
export const STAGE_ORDER = [
  'DISCOVER',
  'INSPECT',
  'SELECT',
  'EXTRACT',
  'RECONCILE',
  'VALIDATE',
  'SOCIAL_DISCOVERY',
  'EXTERNAL_ENRICH',
  'CONSOLIDATE',
  'GAP_RESEARCH',
  'VERIFY',
  'COMPILE',
] as const;

/** Stage that produces the stored profile — the loop stops here. */
export const FINAL_STAGE = 'COMPILE';
