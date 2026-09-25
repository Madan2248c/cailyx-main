/**
 * Digital-presence platform vocabulary — where a company exists on the internet.
 *
 * Ported from the old repo's `digital-presence/presence.types.ts`, trimmed to
 * the part the discovery module's social-discovery stage actually consumes:
 * the platform union and its labels, the company-vs-person split, the
 * found-it-how / how-sure-are-we enums, and the expected-platform table the
 * SERP fallback uses to decide which platforms are still *missing* after the
 * same-site crawl (see docs/analysis/discovery.md, "SERP fallback").
 *
 * Left behind in the old repo (they are that module's own HTTP surface, not
 * shared vocabulary): `PresenceAccountDto`, `PresenceGap`, `DiscoveryRunDto`,
 * `FootprintSection`, `CategoryCoverage`, `PresenceAssessment`,
 * `PresenceInventory` and the rest of its reporting DTOs.
 *
 * Two ideas run through this vocabulary and must not be conflated:
 *
 * - **State** ({@link PresenceState}) — what we know about the account.
 *   Deliberately three-valued. A profile linked from the client's own footer
 *   that we then fail to fetch is `unverified`, never `missing`: Instagram and
 *   Facebook serve login walls and LinkedIn answers datacentre IPs with `999`,
 *   so a failed check is the routine outcome for the platforms that matter most.
 * - **Source** ({@link PresenceSource}) — how we came to know it. Operator entry
 *   outranks both crawlers and survives every re-run.
 *
 * @module discovery/services/presence.types
 */

// ─── Platforms ────────────────────────────────────────────────────────────

/**
 * Platforms this module recognises from a URL. The split into social vs listing
 * is not cosmetic: the two answer different questions for a client ("are you
 * publishing?" vs "are you findable?") and are reported separately.
 */
export type PresencePlatform =
  // social
  | 'linkedin'
  | 'instagram'
  | 'facebook'
  | 'x'
  | 'youtube'
  | 'tiktok'
  | 'pinterest'
  | 'threads'
  // publishing
  | 'medium'
  | 'substack'
  | 'github'
  // listings, review and authority sites
  | 'crunchbase'
  | 'g2'
  | 'capterra'
  | 'trustpilot'
  | 'glassdoor'
  | 'yelp'
  | 'producthunt'
  | 'clutch'
  // marketplaces
  | 'app-store'
  | 'play-store'
  // personal identity hosts — a founder, not the company
  | 'scholar'
  | 'orcid'
  /**
   * A profile the client's own schema markup declares via `sameAs` that no
   * signature recognises — Google Scholar, ORCID, Wikipedia, a trade body, a
   * niche directory. The declaration *is* the authority here, so dropping it
   * for want of a regex would discard the highest-trust signal the site gives.
   */
  | 'other';

export const PRESENCE_PLATFORMS: readonly PresencePlatform[] = [
  'linkedin',
  'instagram',
  'facebook',
  'x',
  'youtube',
  'tiktok',
  'pinterest',
  'threads',
  'medium',
  'substack',
  'github',
  'crunchbase',
  'g2',
  'capterra',
  'trustpilot',
  'glassdoor',
  'yelp',
  'producthunt',
  'clutch',
  'app-store',
  'play-store',
  'scholar',
  'orcid',
  'other',
];

/**
 * The categories stage 2 of the delivery flow actually asks about — "External
 * Presence & Reputation" pairs each one with an *analyse* step:
 *
 * | Discover                       | Analyse                      |
 * |--------------------------------|------------------------------|
 * | Social Media Profiles          | Analyze Social Activity      |
 * | Industry / Business Directories| Analyze Directory Presence   |
 * | Business / Brand Profiles      | Analyze Profiles             |
 * | Relevant Marketplaces          | Analyze Marketplace Presence |
 * | Review Platforms               | Analyze Reviews              |
 *
 * `personal` is a sixth bucket that is deliberately **not** part of the company
 * footprint — see {@link PresenceEntity}.
 */
export type PresenceGroup =
  | 'social'
  | 'directory'
  | 'review'
  | 'marketplace'
  | 'publishing'
  | 'personal'
  | 'other';

export const PLATFORM_GROUP: Record<PresencePlatform, PresenceGroup> = {
  linkedin: 'social',
  instagram: 'social',
  facebook: 'social',
  x: 'social',
  youtube: 'social',
  tiktok: 'social',
  pinterest: 'social',
  threads: 'social',
  medium: 'publishing',
  substack: 'publishing',
  github: 'publishing',
  crunchbase: 'directory',
  clutch: 'directory',
  yelp: 'directory',
  g2: 'review',
  capterra: 'review',
  trustpilot: 'review',
  glassdoor: 'review',
  producthunt: 'marketplace',
  'app-store': 'marketplace',
  'play-store': 'marketplace',
  scholar: 'personal',
  orcid: 'personal',
  other: 'other',
};

export const GROUP_LABELS: Record<PresenceGroup, string> = {
  social: 'Social media profiles',
  directory: 'Industry & business directories',
  review: 'Review platforms',
  marketplace: 'Marketplaces & app stores',
  publishing: 'Publishing channels',
  personal: 'Personal profiles (not the company)',
  other: 'Other declared profiles',
};

/** How each platform is named in a report. */
export const PLATFORM_LABELS: Record<PresencePlatform, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X / Twitter',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  pinterest: 'Pinterest',
  threads: 'Threads',
  medium: 'Medium',
  substack: 'Substack',
  github: 'GitHub',
  crunchbase: 'Crunchbase',
  g2: 'G2',
  capterra: 'Capterra',
  trustpilot: 'Trustpilot',
  glassdoor: 'Glassdoor',
  yelp: 'Yelp',
  producthunt: 'Product Hunt',
  clutch: 'Clutch',
  'app-store': 'Apple App Store',
  'play-store': 'Google Play',
  scholar: 'Google Scholar',
  orcid: 'ORCID',
  other: 'Declared profile',
};

/**
 * What kind of business this is, which is what decides where it *should* be
 * findable. Inferred from the client's category; a heuristic, and the assessment
 * says so rather than presenting it as fact.
 */
export type BusinessProfile = 'b2b-services' | 'b2b-saas' | 'local-services' | 'consumer-brand' | 'default';

/**
 * Where each kind of business is expected to exist.
 *
 * This is the list that decides what counts as a **gap**, so it has to be
 * opinionated per business type rather than universal. A B2B consultancy with no
 * TikTok is not a finding; one with no Clutch profile is. A local trade with no
 * G2 listing is not a finding; one with no Google/Yelp presence is. A single flat
 * list would generate noise for everyone and miss the category that matters to
 * each of them.
 *
 * Deliberately short. Every entry here produces a "missing" row a delivery lead
 * has to explain, so a platform earns its place by being one a *buyer of that
 * kind of business* would actually look at.
 */
export const EXPECTED_BY_PROFILE: Record<BusinessProfile, readonly PresencePlatform[]> = {
  // Consultancies, agencies, professional services: buyers check LinkedIn, then
  // third-party proof on the directories their peers review on.
  'b2b-services': ['linkedin', 'x', 'clutch', 'crunchbase', 'glassdoor'],
  // Software: the review platforms are the shortlist, so they are the gap.
  'b2b-saas': ['linkedin', 'x', 'g2', 'capterra', 'crunchbase', 'github'],
  // Anyone selling locally lives or dies on maps, reviews and Facebook.
  'local-services': ['facebook', 'instagram', 'yelp', 'trustpilot', 'linkedin'],
  // Consumer brands are judged on social reach and public reviews.
  'consumer-brand': ['instagram', 'facebook', 'tiktok', 'youtube', 'trustpilot'],
  // Nothing known about the business — the broad social set only, and the
  // assessment says the category was not identified.
  default: ['linkedin', 'instagram', 'facebook', 'x', 'youtube'],
};

/** Human label for the inferred profile, printed in the assessment. */
export const PROFILE_LABELS: Record<BusinessProfile, string> = {
  'b2b-services': 'B2B services / consultancy',
  'b2b-saas': 'B2B software',
  'local-services': 'Local services',
  'consumer-brand': 'Consumer brand',
  default: 'not identified',
};

/**
 * Guess the business type from the client's own category text.
 *
 * A heuristic over words the client used about themselves — never a claim. The
 * assessment prints which profile was applied so a wrong guess is visible and
 * arguable rather than silently shaping the gaps.
 */
export function inferBusinessProfile(category: string | null | undefined): BusinessProfile {
  const c = (category ?? '').toLowerCase();
  if (!c.trim()) return 'default';
  if (/\b(saas|software|platform|app|api|tool|tech company|product)\b/.test(c)) return 'b2b-saas';
  if (/\b(plumb|electric|roof|dentist|clinic|salon|restaurant|cafe|garage|landscap|builder|contractor|local)\b/.test(c)) {
    return 'local-services';
  }
  if (/\b(retail|ecommerce|e-commerce|dtc|d2c|shop|store|brand|fashion|beauty|food|drink)\b/.test(c)) {
    return 'consumer-brand';
  }
  if (/\b(agency|consult|advisor|partner|services|marketing|studio|firm|b2b)\b/.test(c)) return 'b2b-services';
  return 'default';
}

/** Back-compat default set. Prefer {@link EXPECTED_BY_PROFILE} keyed on the client. */
export const EXPECTED_PLATFORMS: readonly PresencePlatform[] = EXPECTED_BY_PROFILE.default;

/**
 * Whose profile this is.
 *
 * The audit is about **the company**. A founder's personal LinkedIn, their
 * Google Scholar page or their ORCID record are real, and worth recording — but
 * they are not the company's digital footprint, and counting them as such
 * inflates the picture and answers a question nobody asked.
 *
 * `unknown` exists because a handle alone often cannot tell you: an Instagram
 * account could be the brand or the founder. It is reported as company presence
 * (that is the likelier reading for a brand-named handle) but kept flaggable.
 */
export type PresenceEntity = 'company' | 'personal' | 'unknown';

// ─── Account state and provenance ─────────────────────────────────────────

/**
 * `confirmed` — found and the URL resolved.
 * `unverified` — found on the client's own site, but the platform refused the
 *   check. Honest and common; not a problem to fix.
 * `missing` — no link anywhere on the site and nothing supplied by hand.
 * `candidate` — found by **search**, not by the client's own site. We do not
 *   know it is theirs. A real query for `site:instagram.com "HubSpot"` returns
 *   `/hubspot` and `/hubspotacademy` (both theirs) alongside
 *   `/hubshotspodcast` (a different company entirely) — indistinguishable
 *   without a human. Candidates never count as accounts and never reach a
 *   client report until an operator confirms one.
 */
export type PresenceState = 'confirmed' | 'unverified' | 'missing' | 'candidate';

/** Where the account came from. `manual` always wins. */
export type PresenceSource = 'json-ld-sameas' | 'page-link' | 'manual' | 'serp';

export const SOURCE_LABELS: Record<PresenceSource, string> = {
  'json-ld-sameas': 'Declared in schema markup',
  'page-link': 'Linked from the site',
  manual: 'Entered by operator',
  serp: 'Suggested by Google search',
};
