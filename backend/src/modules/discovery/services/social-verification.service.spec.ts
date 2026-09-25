import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FetcherService } from '../../fetcher/fetcher.service.js';
import { SOCIAL_SIGNALS, SOCIAL_STATUS_BANDS } from '../discovery.constants.js';
import {
  SocialVerificationService,
  type SocialCandidate,
  type SocialIdentity,
} from './social-verification.service.js';

/**
 * The point table is the module's whole verdict machinery, so these tests pin
 * the arithmetic rather than the plumbing: which signal fires, what it is worth,
 * and — most importantly — the two rules that stop a wrong profile being stored
 * as a verified one (a SERP hit is never a score; no fetch ⇒ never verified).
 */

const identity: SocialIdentity = { brand: 'Northwind Analytics', domain: 'northwind.io', location: 'Boston' };

/** A profile page that looks like a real, active company account. */
function profilePage(opts: {
  title?: string;
  description?: string;
  body?: string;
  links?: string[];
}): string {
  const body = opts.body ?? 'We help teams understand their data. '.repeat(20);
  const links = (opts.links ?? []).map((href) => `<a href="${href}">link</a>`).join('');
  return [
    '<html><head>',
    opts.title ? `<title>${opts.title}</title>` : '',
    opts.description ? `<meta name="description" content="${opts.description}">` : '',
    '</head><body>',
    body,
    links,
    '</body></html>',
  ].join('');
}

function fetchOk(body: string, url = 'https://example.com') {
  return {
    url,
    finalUrl: url,
    status: 200,
    statusText: 'OK',
    headers: {},
    body,
    timing: { latencyMs: 12 },
    userAgent: 'test',
    cached: false,
    retryCount: 0,
  };
}

describe('SocialVerificationService', () => {
  let service: SocialVerificationService;
  let fetcher: { fetch: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    fetcher = { fetch: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [SocialVerificationService, { provide: FetcherService, useValue: fetcher }],
    }).compile();

    service = moduleRef.get(SocialVerificationService);
  });

  describe('the point table', () => {
    it('scores a same-site linked profile that links back as verified', async () => {
      fetcher.fetch.mockResolvedValue(
        fetchOk(
          profilePage({
            title: 'Northwind Analytics | Data consulting',
            description: 'A data analytics consultancy working with mid-market teams.',
            links: ['https://northwind.io/about'],
          }),
        ),
      );

      const { profile, fetches } = await service.scoreOne(sameSite('github', 'https://github.com/northwind'), identity, true);

      // 45 (site links it) + 20 (title) + 40 (links back) + 5 (active) = 110 → capped 100.
      expect(fetches).toBe(1);
      expect(profile.score).toBe(100);
      expect(profile.status).toBe('verified');
      expect(profile.signals).toContain(`official site links to profile (+${SOCIAL_SIGNALS.OFFICIAL_SITE_LINKS})`);
      expect(profile.signals).toContain(`profile links back to ${identity.domain} (+${SOCIAL_SIGNALS.LINKS_BACK_TO_DOMAIN})`);
    });

    it('awards the link signal alone when nothing else is checkable', async () => {
      // No fetch configured: the service must not be able to read anything.
      fetcher.fetch.mockResolvedValue({ ...fetchOk(''), status: 403 });

      const { profile } = await service.scoreOne(sameSite('youtube', 'https://youtube.com/@unrelated'), {
        ...identity,
        brand: 'Something Else',
        domain: 'somethingelse.com',
      }, true);

      expect(profile.score).toBe(SOCIAL_SIGNALS.OFFICIAL_SITE_LINKS);
      expect(profile.status).toBe('possible');
    });

    it('penalises a handle that names a category rather than a company', async () => {
      fetcher.fetch.mockResolvedValue({ ...fetchOk(''), status: 403 });

      const { profile } = await service.scoreOne(sameSite('instagram', 'https://instagram.com/consulting'), identity, true);

      expect(profile.score).toBe(SOCIAL_SIGNALS.OFFICIAL_SITE_LINKS + SOCIAL_SIGNALS.GENERIC_NAME);
      expect(profile.signals.some((s) => s.includes('generic or ambiguous'))).toBe(true);
    });

    it('penalises a bio that points at a different company domain', async () => {
      fetcher.fetch.mockResolvedValue(
        fetchOk(
          profilePage({
            title: 'Acme Widgets',
            description: 'Acme Widgets of acmewidgets.com — industrial fasteners.',
            body: 'Acme Widgets since 1974.',
          }),
        ),
      );

      // github is not walled, so the bio is actually readable.
      const { profile } = await service.scoreOne(
        sameSite('github', 'https://github.com/acme-widgets'),
        identity,
        true,
      );

      // 45 + 5 (active) − 40 (a different company's domain in the bio) = 10.
      expect(profile.score).toBe(SOCIAL_SIGNALS.OFFICIAL_SITE_LINKS + SOCIAL_SIGNALS.ACTIVE_BUSINESS_PROFILE + SOCIAL_SIGNALS.DIFFERENT_DOMAIN);
      expect(profile.status).toBe('rejected');
      expect(profile.signals.some((sig) => sig.includes('different company domain'))).toBe(true);
    });

    // Regression test for a real defect this suite caught: `otherCompanyDomainInBio`
    // built its host from `match[2]` while `DOMAIN_TOKEN`'s TLD group is
    // non-capturing, so the host was always "northwind.undefined" and neither
    // guard could match — the −40 penalty meant for *other* companies' domains
    // fired on the client's own. Fixed in the service by reading `match[0]`.
    it('does not penalise a profile that names the client’s own domain', async () => {
      fetcher.fetch.mockResolvedValue(
        fetchOk(
          profilePage({
            title: 'Northwind Analytics',
            description: 'Data analytics for mid-market teams — northwind.io',
            links: ['https://northwind.io/about'],
          }),
        ),
      );

      const { profile } = await service.scoreOne(sameSite('github', 'https://github.com/northwind'), identity, true);

      // 45 + 20 (name match) + 40 (links back) + 5 (active) = 110 → capped 100.
      expect(profile.score).toBe(100);
      expect(profile.status).toBe('verified');
      expect(profile.signals.some((sig) => sig.includes('different company domain'))).toBe(false);
    });

    it('still penalises a profile pointing at a different company’s domain', async () => {
      fetcher.fetch.mockResolvedValue(
        fetchOk(
          profilePage({
            title: 'Northwind Analytics',
            description: 'Data analytics for mid-market teams — someotherco.com',
            links: ['https://northwind.io/about'],
          }),
        ),
      );

      const { profile } = await service.scoreOne(sameSite('github', 'https://github.com/northwind'), identity, true);

      // 45 + 20 + 40 + 5 − 40 = 70, and the host is reported as it really is.
      expect(profile.score).toBe(70);
      expect(profile.status).toBe('probable');
      expect(profile.signals.some((sig) => sig.includes('someotherco.com'))).toBe(true);
    });

    it('scores zero when the linked profile no longer exists', async () => {
      fetcher.fetch.mockResolvedValue({ ...fetchOk(''), status: 404 });

      const { profile } = await service.scoreOne(sameSite('github', 'https://github.com/northwind'), identity, true);

      // The site's link is evidence of a *dead* account, so nothing it earned survives.
      expect(profile.score).toBe(0);
      expect(profile.status).toBe('rejected');
    });
  });

  describe('the two rules that matter most', () => {
    it('never verifies a walled platform, even with every obtainable signal', async () => {
      fetcher.fetch.mockResolvedValue(fetchOk(profilePage({ title: 'Northwind Analytics' })));

      // LinkedIn is walled: linked by the site, handle matches the brand — 65.
      const { profile, fetches } = await service.scoreOne(
        sameSite('linkedin', 'https://linkedin.com/company/northwind'),
        identity,
        true,
      );

      expect(fetches).toBe(0);
      expect(fetcher.fetch).not.toHaveBeenCalled();
      expect(profile.walled).toBe(true);
      expect(profile.score).toBe(SOCIAL_SIGNALS.OFFICIAL_SITE_LINKS + SOCIAL_SIGNALS.NAME_MATCH);
      expect(profile.status).toBe('probable');
      expect(profile.status).not.toBe('verified');
    });

    it('caps at one below the verified band whenever no profile was read', async () => {
      // A same-site LinkedIn link plus a matching handle is the best a walled
      // platform can do; assert the ceiling is the band, not the raw sum.
      const capped = await service.scoreOne(sameSite('linkedin', 'https://linkedin.com/company/northwind'), identity, true);
      expect(capped.profile.score).toBeLessThan(SOCIAL_STATUS_BANDS.VERIFIED);

      // And with no request budget, a fetchable platform is treated the same way.
      const noBudget = await service.scoreOne(sameSite('github', 'https://github.com/northwind'), identity, false);
      expect(fetcher.fetch).not.toHaveBeenCalled();
      expect(noBudget.profile.score).toBeLessThan(SOCIAL_STATUS_BANDS.VERIFIED);
    });

    it('never grants a SERP candidate the official-site link signal', async () => {
      fetcher.fetch.mockResolvedValue(
        fetchOk(profilePage({ title: 'Northwind Analytics', links: ['https://northwind.io'] })),
      );

      const { profile } = await service.scoreOne(serp('github', 'https://github.com/northwind', 0.9), identity, true);

      expect(profile.signals.some((s) => s.startsWith('official site links'))).toBe(false);
      // 20 (title) + 40 (links back) + 5 (active) — no +45, because nothing on
      // the company's own site vouched for it.
      expect(profile.score).toBe(SOCIAL_SIGNALS.NAME_MATCH + SOCIAL_SIGNALS.LINKS_BACK_TO_DOMAIN + SOCIAL_SIGNALS.ACTIVE_BUSINESS_PROFILE);
    });

    it('leaves a SERP-only hit below the verified band even when it reads perfectly', async () => {
      fetcher.fetch.mockResolvedValue(
        fetchOk(
          profilePage({
            title: 'Northwind Analytics',
            description: 'Data analytics for mid-market teams in Boston.',
            links: ['https://northwind.io'],
          }),
        ),
      );

      const { profile } = await service.scoreOne(serp('github', 'https://github.com/northwind', 0.95), identity, true);

      // 20 + 40 + 10 (Boston) + 5 = 75: verified requires the company's own site
      // to link the profile, and the company's own site is what a SERP hit lacks.
      expect(profile.score).toBe(75);
      expect(profile.status).toBe('probable');
    });
  });

  describe('pre-filter (SERP only)', () => {
    it('drops SERP candidates below the similarity floor and reports them', async () => {
      async function never() {
        throw new Error('a pre-filtered candidate must not be scored or fetched');
      }
      fetcher.fetch.mockImplementation(never);

      const { scored, prefilted } = await service.scoreAll(
        [serp('instagram', 'https://instagram.com/maybe', 0.2), sameSite('github', 'https://github.com/northwind')],
        identity,
        5,
      );

      expect(scored.map((s) => s.profile.url)).toEqual(['https://github.com/northwind']);
      expect(prefilted.map((c) => c.url)).toEqual(['https://instagram.com/maybe']);
    });

    it('does not pre-filter same-site candidates — the site itself linked them', async () => {
      fetcher.fetch.mockResolvedValue({ ...fetchOk(''), status: 403 });

      const { scored, prefilted } = await service.scoreAll(
        [sameSite('github', 'https://github.com/northwind'), sameSite('youtube', 'https://youtube.com/@northwind')],
        identity,
        5,
      );

      expect(scored).toHaveLength(2);
      expect(prefilted).toHaveLength(0);
    });

    it('spends a fetch per candidate but never more than the budget', async () => {
      fetcher.fetch.mockResolvedValue({ ...fetchOk(''), status: 403 });

      const { fetches } = await service.scoreAll(
        [
          sameSite('github', 'https://github.com/a'),
          sameSite('youtube', 'https://youtube.com/@b'),
          sameSite('crunchbase', 'https://crunchbase.com/organization/c'),
        ],
        identity,
        2,
      );

      // Two fetches spent, and the third candidate is still scored — on its
      // handle only, which is exactly the position a wall leaves you in.
      expect(fetches).toBe(2);
      expect(fetcher.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('isWalled', () => {
    it('knows the platforms that block logged-out requests', () => {
      expect(service.isWalled('linkedin')).toBe(true);
      expect(service.isWalled('instagram')).toBe(true);
      expect(service.isWalled('github')).toBe(false);
      expect(service.isWalled('crunchbase')).toBe(true);
    });
  });
});

function sameSite(platform: SocialCandidate['platform'], url: string): SocialCandidate {
  return {
    platform,
    url,
    handle: url.split('/').filter(Boolean).pop() ?? '',
    entity: 'company',
    discoveryMethod: 'link-scan',
  };
}

function serp(platform: SocialCandidate['platform'], url: string, nameSimilarity: number): SocialCandidate {
  return { ...sameSite(platform, url), discoveryMethod: 'serp', nameSimilarity };
}
