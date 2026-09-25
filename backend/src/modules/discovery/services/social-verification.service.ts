/**
 * Social profile verification — **our own** scoring pass over whatever the
 * discovery passes found.
 *
 * Implements the spec doc's step-16 point table against the signals a fetch can
 * actually produce, replacing the old repo's `PresenceDiscoveryService.verify()`
 * (which produced a 4-value enum with no numeric score and could not satisfy
 * `social_profiles.verification_status`). See docs/analysis/discovery.md,
 * "Social profile verification — reconciled design" — that section is the
 * specification for this file, and the table below is its table.
 *
 * ## The scoring rule
 *
 * | Signal | Points | Needs a fetch? |
 * |---|---|---|
 * | Official website links to the profile | +45 | no — this is what same-site discovery finds |
 * | Profile links back to the exact company domain | +40 | yes |
 * | Exact company/brand name match | +20 | no — the handle is checkable from the URL alone |
 * | Matching location | +10 | yes |
 * | Active, business-oriented profile | +5 | yes |
 * | Generic or ambiguous name | −15 | no |
 * | A different company's domain in the profile's bio | −40 | yes |
 *
 * Two signals from the spec doc's full table are deliberately **not**
 * implemented rather than stubbed: matching logo/branding (needs image
 * comparison) and matching phone/email (the doc's richer identity signals, not
 * present in either source's data model). A stubbed signal would be
 * indistinguishable from a checked-and-absent one in the output.
 *
 * ## The two rules that matter most
 *
 * 1. **A SERP hit is a candidate, never a score.** A candidate's 0–1
 *    name-similarity (`PresenceSerpService`'s `confidence`) is a *pre-filter*
 *    for deciding which candidates are worth spending a fetch on — it never
 *    adds a point, never substitutes for the table above, and never on its own
 *    produces a stored profile. The design doc is explicit about this, and it is
 *    the difference between "a search engine said this might be you" and "this
 *    is you".
 * 2. **No fetch ⇒ never `verified`.** A platform we could not read (walled, or
 *    the fetch failed, or the request budget ran out) is clamped below the
 *    verified band, because every signal that could establish identity lives on
 *    the profile page we did not see. The clamp is explicit rather than
 *    emergent — relying on "the available signals happen not to sum past 79"
 *    would break silently the day a signal is added.
 */

import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { FetcherService } from '../../fetcher/fetcher.service.js';
import { SERP_NAME_SIMILARITY_FLOOR, SOCIAL_SIGNALS, SOCIAL_STATUS_BANDS, WALLED_HOSTS } from '../discovery.constants.js';
import type { ScoredSocialProfile, SocialDiscoveryMethod, SocialStatus } from '../discovery.types.js';
import { hostOf } from './pipeline-utils.js';
import type { PresenceEntity, PresencePlatform } from './presence.types.js';

/** One unverified profile candidate, from either discovery pass. */
export interface SocialCandidate {
  platform: PresencePlatform;
  url: string;
  handle: string;
  entity: PresenceEntity;
  discoveryMethod: SocialDiscoveryMethod;
  /** SERP-only: 0–1 handle/brand similarity. A pre-filter, never a score. */
  nameSimilarity?: number;
  /** SERP-only: the result title, carried for the operator's eye. */
  title?: string | null;
}

/** What the scorer knows about the company — all optional but the brand. */
export interface SocialIdentity {
  brand: string;
  domain: string;
  /** Headquarter text as extracted, e.g. "Austin, Texas" — drives the location signal. */
  location?: string | null;
}

export interface ScoredCandidate {
  profile: ScoredSocialProfile;
  /** Fetches this candidate spent (0 for walled platforms, which are never fetched). */
  fetches: number;
  /** Set when the candidate was rejected — the reason, for the run's notes. */
  rejection: string | null;
}

/** Cap on how many SERP candidates per platform are worth a fetch. */
const MAX_SERP_CANDIDATES_PER_PLATFORM = 3;

/**
 * Handle words that identify a category, not a company. A profile at
 * `instagram.com/consulting` is not evidence of anything — there are thousands
 * of them — so the name-match signal must not fire on one, and the
 * generic-name penalty should.
 */
const GENERIC_HANDLES = new Set([
  'consulting',
  'consultant',
  'consultants',
  'agency',
  'agencies',
  'design',
  'designer',
  'studio',
  'studios',
  'marketing',
  'services',
  'service',
  'media',
  'group',
  'company',
  'tech',
  'digital',
  'creative',
  'solutions',
  'partners',
  'official',
  'business',
  'shop',
  'store',
  'team',
  'support',
  'info',
]);

/**
 * Hosts that are never "some other company's domain" in a profile bio — social
 * platforms, link shorteners and generic infrastructure. Without this list the
 * different-domain penalty would fire on any profile that links its own
 * platform or a booking tool.
 */
const NON_COMPANY_HOSTS = /^(?:[a-z0-9-]+\.)*(?:linkedin|instagram|facebook|fb|x|twitter|tiktok|threads|youtube|youtu|pinterest|medium|substack|github|gitlab|crunchbase|g2|capterra|trustpilot|glassdoor|yelp|producthunt|clutch|apple|google|play|bit|lnk|linktr|beacons|calendly|hubspot|mailchimp|shopify|wix|squarespace|wordpress|typeform|eventbrite|zoom|notion)\.(?:com|co|io|me|to|ly|net|org)$/i;

/** Domain-shaped token inside free text — used to spot a bio pointing elsewhere. */
const DOMAIN_TOKEN = /\b([a-z0-9][a-z0-9-]{1,62})\.(?:com|co|io|net|org|ai|dev|app|studio|agency|consulting|tech|software|solutions|services|group)\b/gi;

@Injectable()
export class SocialVerificationService {
  private readonly logger = new Logger(SocialVerificationService.name);

  constructor(private readonly fetcher: FetcherService) {}

  /**
   * Platforms that answer a logged-out request with a wall, so we never ask.
   * Takes a plain string because callers reach it with a stored platform value,
   * which is text in the schema rather than the enum.
   */
  isWalled(platform: string): boolean {
    const host = HOST_BY_PLATFORM[platform as PresencePlatform];
    return host !== undefined && WALLED_HOSTS.has(host);
  }

  /**
   * Score a batch, spending at most `fetchBudget` fetches.
   *
   * SERP candidates whose name similarity is below
   * {@link SERP_NAME_SIMILARITY_FLOOR} are dropped here rather than scored — the
   * floor decides what is worth *checking*, and a candidate the pre-filter
   * dropped has nothing left to check. When a platform's SERP results are all
   * below the floor, nothing is stored for it and the caller reports `not_found`,
   * which the spec doc prefers over a false positive.
   */
  async scoreAll(
    candidates: SocialCandidate[],
    identity: SocialIdentity,
    fetchBudget: number,
  ): Promise<{ scored: ScoredCandidate[]; fetches: number; prefilted: SocialCandidate[] }> {
    const { kept, dropped } = prefilterSerpCandidates(candidates);
    const scored: ScoredCandidate[] = [];
    let fetches = 0;

    for (const candidate of kept) {
      const remaining = fetchBudget - fetches;
      const outcome = await this.scoreOne(candidate, identity, remaining > 0);
      fetches += outcome.fetches;
      scored.push(outcome);
    }

    return { scored, fetches, prefilted: dropped };
  }

  /** Score one candidate. `mayFetch` false means the request budget is gone. */
  async scoreOne(candidate: SocialCandidate, identity: SocialIdentity, mayFetch: boolean): Promise<ScoredCandidate> {
    const signals: string[] = [];
    let score = 0;
    let fetches = 0;

    // The one signal every same-site candidate earns by definition: the
    // company's own site links to it. A SERP candidate was found *because* the
    // site does not link it, so it must not be granted this.
    if (candidate.discoveryMethod !== 'serp') {
      score += SOCIAL_SIGNALS.OFFICIAL_SITE_LINKS;
      signals.push(`official site links to profile (+${SOCIAL_SIGNALS.OFFICIAL_SITE_LINKS})`);
    }

    const walled = this.isWalled(candidate.platform);
    // The handle is checkable without a fetch, which is why a walled platform
    // can still reach `probable` — and why it can never reach `verified`.
    const slugMatches = handleMatchesBrand(candidate.handle, identity);
    let sawProfile = false;

    let gone = false;
    if (!walled && mayFetch) {
      const fetched = await this.fetchProfile(candidate.url);
      fetches = 1;
      if (fetched.kind === 'gone') {
        // A definitive "gone" on a platform we *could* have read means the
        // profile the site links to no longer exists. The link is then evidence
        // of a dead account, not of a present one, so nothing it earned counts.
        gone = true;
        signals.push(`the linked profile is gone (HTTP ${fetched.status})`);
      }
      const page = fetched.kind === 'ok' ? fetched.page : null;
      if (page) {
        sawProfile = true;
        const titleMatches = page.title ? titleMatchesBrand(page.title, identity) : false;
        if (titleMatches) {
          score += SOCIAL_SIGNALS.NAME_MATCH;
          signals.push(`profile title matches brand (+${SOCIAL_SIGNALS.NAME_MATCH})`);
        }
        if (linksBackToDomain(page, identity.domain)) {
          score += SOCIAL_SIGNALS.LINKS_BACK_TO_DOMAIN;
          signals.push(`profile links back to ${identity.domain} (+${SOCIAL_SIGNALS.LINKS_BACK_TO_DOMAIN})`);
        }
        if (locationMatches(page, identity.location)) {
          score += SOCIAL_SIGNALS.LOCATION_MATCH;
          signals.push(`profile names the company's location (+${SOCIAL_SIGNALS.LOCATION_MATCH})`);
        }
        if (looksLikeActiveBusinessProfile(page)) {
          score += SOCIAL_SIGNALS.ACTIVE_BUSINESS_PROFILE;
          signals.push(`active, business-oriented profile (+${SOCIAL_SIGNALS.ACTIVE_BUSINESS_PROFILE})`);
        }
        const elsewhere = otherCompanyDomainInBio(page, identity.domain);
        if (elsewhere) {
          score += SOCIAL_SIGNALS.DIFFERENT_DOMAIN;
          signals.push(`bio points at a different company domain (${elsewhere}) (${SOCIAL_SIGNALS.DIFFERENT_DOMAIN})`);
        }
      } else if (!gone) {
        // Walled-in-practice, blocked or unreachable: no fetch-derived signal is
        // available, so fall back to the handle exactly as we would for a wall.
        signals.push('profile could not be read — only the handle was checkable');
      }
    } else if (!walled) {
      signals.push('no request budget left to read the profile — only the handle was checkable');
    }

    // Slug-level name match applies whether or not we could fetch, and is
    // skipped only when the fetched title already earned the same signal.
    if (slugMatches && !gone && !signals.some((s) => s.startsWith('profile title matches brand'))) {
      score += SOCIAL_SIGNALS.NAME_MATCH;
      signals.push(`handle matches brand (+${SOCIAL_SIGNALS.NAME_MATCH})`);
    }

    if (isGenericHandle(candidate.handle)) {
      score += SOCIAL_SIGNALS.GENERIC_NAME;
      signals.push(`generic or ambiguous handle (${SOCIAL_SIGNALS.GENERIC_NAME})`);
    }

    // Capped, not an unbounded raw sum — the spec doc's own requirement. The
    // full positive set sums to 120, so the cap is what keeps the 0–100 bands
    // meaningful.
    let capped = gone ? 0 : clamp(score, 0, 100);

    // No fetch ⇒ no verification, enforced rather than inferred.
    const verified = sawProfile && !walled;
    if (!verified) {
      capped = Math.min(capped, SOCIAL_STATUS_BANDS.VERIFIED - 1);
    }

    const status = bandFor(capped);
    const profile: ScoredSocialProfile = {
      platform: candidate.platform,
      url: candidate.url,
      discoveryMethod: candidate.discoveryMethod,
      score: capped,
      status,
      walled,
      signals,
    };

    return {
      profile,
      fetches,
      rejection: status === 'rejected' ? rejectionReason(candidate, walled, sawProfile, gone) : null,
    };
  }

  // ─── Fetch ──────────────────────────────────────────────────────────────

  /**
   * Fetch one profile page, distinguishing the two ways a fetch fails.
   *
   * `gone` is a definitively absent profile — and the distinction matters
   * because the two cases support opposite conclusions. A 404/410 on a platform
   * we could have read means the account the site links to no longer exists, so
   * nothing the link earned should survive. Everything else — a block, a
   * challenge, a 5xx, a timeout, an empty body — means we simply could not look,
   * which is the same epistemic position as a wall and is treated the same way.
   */
  private async fetchProfile(url: string): Promise<ProfileFetch> {
    try {
      const res = await this.fetcher.fetch({ url, timeout: 15_000 }, 'discovery-social-verify');
      // 403/429 are the standard deliberate-block responses (WAF, rate limit,
      // Cloudflare challenge) — on a platform we did not expect to be walled
      // that says nothing about the profile's existence.
      if (res.status === 403 || res.status === 429) {
        return { kind: 'unreadable', reason: `HTTP ${res.status}` };
      }
      if (res.status === 404 || res.status === 410) return { kind: 'gone', status: res.status };
      if (res.status < 200 || res.status >= 400 || !res.body) {
        return { kind: 'unreadable', reason: `HTTP ${res.status}` };
      }

      const $ = cheerio.load(res.body);
      const title =
        ($('meta[property="og:title"]').attr('content') || $('title').text() || '').trim().replace(/\s+/g, ' ') || null;
      const description = (
        $('meta[name="description"]').attr('content') ||
        $('meta[property="og:description"]').attr('content') ||
        ''
      )
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 600);
      const bodyText = $('body').text().trim().replace(/\s+/g, ' ').slice(0, 5_000);
      const linkHosts: string[] = [];
      $('a[href]').each((_, el) => {
        const h = hostOf($(el).attr('href') || '');
        if (h) linkHosts.push(h);
      });

      return { kind: 'ok', page: { url: res.finalUrl || url, title, description, bodyText, linkHosts } };
    } catch (err) {
      this.logger.debug(`Social verify fetch failed for ${url}: ${(err as Error).message}`);
      return { kind: 'unreadable', reason: (err as Error).message };
    }
  }
}

// ─── Signal helpers ─────────────────────────────────────────────────────────

interface FetchedProfile {
  url: string;
  title: string | null;
  description: string;
  bodyText: string;
  linkHosts: string[];
}

/** The three outcomes of trying to read a profile — see {@link SocialVerificationService.fetchProfile}. */
type ProfileFetch =
  | { kind: 'ok'; page: FetchedProfile }
  | { kind: 'gone'; status: number }
  | { kind: 'unreadable'; reason: string };

/** Alphanumeric-only lowercase form — handles use underscores/dots where names use spaces. */
function fold(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The company's identifying tokens: the brand, and the domain's own first label. */
function identityTokens(identity: SocialIdentity): string[] {
  const tokens: string[] = [];
  const domainLabel = identity.domain.replace(/^www\./, '').split('.')[0];
  if (domainLabel) tokens.push(fold(domainLabel));
  const brand = fold(identity.brand);
  if (brand) tokens.push(brand);
  return tokens.filter((t) => t.length >= 3);
}

function handleMatchesBrand(handle: string, identity: SocialIdentity): boolean {
  const h = fold(handle);
  if (!h) return false;
  for (const token of identityTokens(identity)) {
    if (h === token) return true;
    // A handle routinely appends or prepends a qualifier — `hubspotlife`,
    // `gethubspot`, `hubspot_uk` are all the same company. Requiring a
    // reasonable overlap keeps "consulting" from matching "consultingco".
    if (token.length >= 4 && (h.startsWith(token) || h.endsWith(token))) return true;
  }
  return false;
}

function titleMatchesBrand(title: string, identity: SocialIdentity): boolean {
  const t = fold(title);
  if (!t) return false;
  for (const token of identityTokens(identity)) {
    if (token.length >= 5 && t.includes(token)) return true;
  }
  return false;
}

/** Does the page link to the client's own domain (or a subdomain of it)? */
function linksBackToDomain(page: FetchedProfile, domain: string): boolean {
  const own = domain.replace(/^www\./, '').toLowerCase();
  return page.linkHosts.some((host) => host === own || host.endsWith(`.${own}`));
}

function locationMatches(page: FetchedProfile, location: string | null | undefined): boolean {
  if (!location) return false;
  const haystack = (page.title ?? '') + ' ' + page.description + ' ' + page.bodyText;
  const hay = fold(haystack);
  // Require a distinctive word from the location — "Austin" yes, "United" no.
  return location
    .split(/[\s,]+/)
    .map(fold)
    .filter((w) => w.length >= 4)
    .some((word) => hay.includes(word));
}

/**
 * An active, business-oriented profile: it resolves, carries a real title, and
 * has some substance behind it (a description or a usable body). A bare
 * placeholder page — "Profile not found", a name-only shell — does not qualify.
 */
function looksLikeActiveBusinessProfile(page: FetchedProfile): boolean {
  if (!page.title) return false;
  return page.description.length >= 20 || page.bodyText.length >= 200;
}

/**
 * A company domain named in the profile's bio that is not the client's.
 *
 * Deliberately narrow: only the title and description are searched — the
 * surfaces that *are* a profile's self-description — and the penalty only fires
 * when the page never links the client's own domain. Scanning body links
 * instead would fire on every profile that links a booking tool or a partner.
 *
 * @returns The offending domain, or null when there is nothing to report.
 */
function otherCompanyDomainInBio(page: FetchedProfile, domain: string): string | null {
  const own = domain.replace(/^www\./, '').toLowerCase();
  const bio = `${page.title ?? ''} ${page.description}`;
  for (const match of bio.matchAll(DOMAIN_TOKEN)) {
    // `match[0]` is the whole `label.tld` token — the regex's TLD group is
    // non-capturing, so reading capture groups here would build "label.undefined"
    // and leave both guards below unable to ever match.
    const host = match[0].toLowerCase();
    if (host.endsWith(own) || own.endsWith(host)) continue;
    if (NON_COMPANY_HOSTS.test(host)) continue;
    return host;
  }
  return null;
}

/** A category word rather than a company — see {@link GENERIC_HANDLES}. */
function isGenericHandle(handle: string): boolean {
  const h = fold(handle);
  if (!h) return false;
  if (GENERIC_HANDLES.has(h)) return true;
  // `consultinggroup`, `theagency` — a generic word with nothing distinguishing it.
  return [...GENERIC_HANDLES].some((word) => h === word || h === `the${word}` || h === `${word}inc`);
}

function bandFor(score: number): SocialStatus {
  if (score >= SOCIAL_STATUS_BANDS.VERIFIED) return 'verified';
  if (score >= SOCIAL_STATUS_BANDS.PROBABLE) return 'probable';
  if (score >= SOCIAL_STATUS_BANDS.POSSIBLE) return 'possible';
  return 'rejected';
}

function rejectionReason(candidate: SocialCandidate, walled: boolean, sawProfile: boolean, gone: boolean): string {
  if (gone) return 'the profile the site links to no longer exists';
  if (walled && candidate.discoveryMethod !== 'serp') {
    return 'the site links to it but the platform cannot be read — not enough evidence to call it the company account';
  }
  if (sawProfile) return 'the profile page did not carry enough identity evidence';
  if (candidate.discoveryMethod === 'serp') return 'only found by search, and nothing on it could be verified';
  return 'the profile could not be read';
}

/**
 * The pre-filter, kept separate from scoring so it can never be mistaken for
 * part of it. For each platform, candidates are ranked by the SERP-provided
 * name similarity and only those at or above the floor survive; same-site
 * candidates have no pre-filter at all (the site itself linked them, which is
 * stronger evidence than any name guess).
 */
function prefilterSerpCandidates(candidates: SocialCandidate[]): {
  kept: SocialCandidate[];
  dropped: SocialCandidate[];
} {
  const kept: SocialCandidate[] = [];
  const dropped: SocialCandidate[] = [];
  const serpByPlatform = new Map<string, SocialCandidate[]>();

  for (const c of candidates) {
    if (c.discoveryMethod !== 'serp') {
      kept.push(c);
      continue;
    }
    const list = serpByPlatform.get(c.platform) ?? [];
    list.push(c);
    serpByPlatform.set(c.platform, list);
  }

  for (const list of serpByPlatform.values()) {
    const ranked = [...list].sort((a, b) => (b.nameSimilarity ?? 0) - (a.nameSimilarity ?? 0));
    const strong = ranked.filter((c) => (c.nameSimilarity ?? 0) >= SERP_NAME_SIMILARITY_FLOOR);
    kept.push(...strong.slice(0, MAX_SERP_CANDIDATES_PER_PLATFORM));
    dropped.push(...ranked.slice(strong.length));
  }

  return { kept, dropped };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Platform → the host that would appear in a profile URL, for the walled check. */
const HOST_BY_PLATFORM: Partial<Record<PresencePlatform, string>> = {
  linkedin: 'linkedin.com',
  instagram: 'instagram.com',
  facebook: 'facebook.com',
  x: 'x.com',
  tiktok: 'tiktok.com',
  threads: 'threads.net',
  g2: 'g2.com',
  crunchbase: 'crunchbase.com',
  glassdoor: 'glassdoor.com',
};
