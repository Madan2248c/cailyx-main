import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PrismaService } from '../../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../../test/mocks/prisma.mock.js';
import { RunBudget, type DiscoveryRunContext } from '../pipeline-context.js';
import { PresenceDiscoveryService, type DiscoveredAccount } from '../presence-discovery.service.js';
import { PresenceSerpService } from '../presence-serp.service.js';
import { SocialVerificationService } from '../social-verification.service.js';
import { EXPECTED_PLATFORMS } from '../presence.types.js';
import { SocialDiscoveryStage } from './social-discovery.stage.js';

/**
 * The order and scope of the three passes is the design here, and two of the
 * assertions below are the ones the design doc calls out for live verification:
 * the SERP sweep must query **only** platforms same-site discovery did not find,
 * and its query ceiling is a ceiling on the whole run, not on one sweep.
 */

describe('SocialDiscoveryStage', () => {
  let stage: SocialDiscoveryStage;
  let prisma: PrismaMock;
  let presenceDiscovery: { crawl: ReturnType<typeof vi.fn> };
  let presenceSerp: { sweep: ReturnType<typeof vi.fn> };
  let verification: { scoreAll: ReturnType<typeof vi.fn> };

  const project = { id: 'project-1', name: 'Northwind Analytics', domain: 'northwind.io' };

  function context(state: DiscoveryRunContext['state'] = {}): DiscoveryRunContext & { notes: string[] } {
    const notes: string[] = [];
    return {
      runId: 'run-1',
      project,
      budget: new RunBudget(
        { pages: 0, requests: 0, chars: 0, elapsedMs: 0 },
        { maxPages: 12, maxRequests: 40, maxChars: 24_000, maxElapsedMs: 300_000, maxRetriesPerPage: 2 },
      ),
      state,
      logger: { debug: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      note: vi.fn(async (text: string) => {
        notes.push(text);
      }),
      checkpoint: vi.fn(async () => {}),
      notes,
    };
  }

  function account(platform: DiscoveredAccount['platform'], handle: string): DiscoveredAccount {
    return {
      platform,
      url: `https://${platform}.com/${handle}`,
      handle,
      entity: 'company',
      source: 'json-ld-sameas',
      foundOn: 'https://northwind.io/',
    };
  }

  /** A scored candidate as the verification service would return it. */
  function scored(platform: string, url: string, status: string, rejection: string | null = null) {
    return {
      profile: { platform, url, discoveryMethod: 'link-scan', score: status === 'rejected' ? 20 : 65, status, walled: true, signals: [] },
      fetches: 0,
      rejection,
    };
  }

  beforeEach(async () => {
    prisma = createPrismaMock();
    presenceDiscovery = { crawl: vi.fn() };
    presenceSerp = { sweep: vi.fn() };
    verification = { scoreAll: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SocialDiscoveryStage,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: ConfigService, useValue: { get: vi.fn((_key: string, fallback: unknown) => fallback) } },
        { provide: PresenceDiscoveryService, useValue: presenceDiscovery },
        { provide: PresenceSerpService, useValue: presenceSerp },
        { provide: SocialVerificationService, useValue: verification },
      ],
    }).compile();

    stage = moduleRef.get(SocialDiscoveryStage);
    prisma.socialProfile.findFirst.mockResolvedValue(null);
    prisma.socialProfile.create.mockResolvedValue({ id: 'profile-1' });
    presenceSerp.sweep.mockResolvedValue({ candidates: [], queriesSpent: 0, costUsd: 0, skipped: null });
  });

  describe('SERP fallback scope', () => {
    it('searches only for expected platforms same-site discovery did not find', async () => {
      presenceDiscovery.crawl.mockResolvedValue({ accounts: [account('linkedin', 'northwind')], pagesFetched: 4 });
      verification.scoreAll.mockResolvedValue({ scored: [], fetches: 0, prefilted: [] });

      await stage.run(context());

      // The crawl found LinkedIn, so it is the one platform NOT searched for.
      const expected = [...EXPECTED_PLATFORMS];
      expect(expected).toContain('linkedin');
      expect(presenceSerp.sweep).toHaveBeenCalledTimes(1);
      expect(presenceSerp.sweep).toHaveBeenCalledWith('Northwind Analytics', 'northwind.io', expected.filter((p) => p !== 'linkedin'));
    });

    it('does not search at all when the crawl found every expected platform', async () => {
      presenceDiscovery.crawl.mockResolvedValue({
        accounts: EXPECTED_PLATFORMS.map((p) => account(p, 'northwind')),
        pagesFetched: 4,
      });
      verification.scoreAll.mockResolvedValue({ scored: [], fetches: 0, prefilted: [] });

      const ctx = context();
      await stage.run(ctx);

      expect(presenceSerp.sweep).not.toHaveBeenCalled();
      expect(ctx.notes.join(' ')).toContain('every expected platform already has a same-site profile');
    });

    it('treats the query ceiling as a ceiling on the run, not on one sweep', async () => {
      presenceDiscovery.crawl.mockResolvedValue({ accounts: [], pagesFetched: 4 });
      verification.scoreAll.mockResolvedValue({ scored: [], fetches: 0, prefilted: [] });

      // A previous job in the same run already spent the whole ceiling.
      const ctx = context({ search: { queriesRun: 20, costUsd: 0.02, fieldsSearched: [] } });
      await stage.run(ctx);

      expect(presenceSerp.sweep).not.toHaveBeenCalled();
      expect(ctx.notes.join(' ')).toContain('20-query ceiling');
    });

    it('does not re-sweep platforms an earlier job already swept', async () => {
      presenceDiscovery.crawl.mockResolvedValue({ accounts: [], pagesFetched: 4 });
      verification.scoreAll.mockResolvedValue({ scored: [], fetches: 0, prefilted: [] });

      const ctx = context({ search: { queriesRun: 3, costUsd: 0, fieldsSearched: ['linkedin', 'instagram'] } });
      await stage.run(ctx);

      const swept = presenceSerp.sweep.mock.calls[0][2] as string[];
      expect(swept).not.toContain('linkedin');
      expect(swept).not.toContain('instagram');
    });

    it('records the sweep against the run even when the sweep was skipped', async () => {
      presenceDiscovery.crawl.mockResolvedValue({ accounts: [], pagesFetched: 4 });
      verification.scoreAll.mockResolvedValue({ scored: [], fetches: 0, prefilted: [] });
      presenceSerp.sweep.mockResolvedValue({ candidates: [], queriesSpent: 0, costUsd: 0, skipped: 'DataForSEO is disabled' });

      const ctx = context();
      await stage.run(ctx);

      // Reported, not swallowed — and marked as looked-at so a re-enqueue does
      // not pay to look again.
      expect(ctx.notes.join(' ')).toContain('DataForSEO is disabled');
      expect(ctx.state.search?.fieldsSearched).toEqual([...EXPECTED_PLATFORMS]);
    });

    it('accumulates search spend across runs of the stage', async () => {
      presenceDiscovery.crawl.mockResolvedValue({ accounts: [], pagesFetched: 4 });
      verification.scoreAll.mockResolvedValue({ scored: [], fetches: 0, prefilted: [] });
      presenceSerp.sweep.mockResolvedValue({ candidates: [], queriesSpent: 7, costUsd: 0.03, skipped: null });

      const ctx = context({ search: { queriesRun: 5, costUsd: 0.01, fieldsSearched: ['g2'] } });
      await stage.run(ctx);

      expect(ctx.state.search).toMatchObject({ queriesRun: 12 });
      expect(ctx.state.search?.costUsd).toBeCloseTo(0.04, 5);
    });
  });

  describe('persistence', () => {
    it('stores survivors and never stores a rejected candidate', async () => {
      presenceDiscovery.crawl.mockResolvedValue({
        accounts: [account('github', 'northwind'), account('youtube', '@unrelated')],
        pagesFetched: 4,
      });
      verification.scoreAll.mockResolvedValue({
        scored: [
          scored('github', 'https://github.com/northwind', 'verified'),
          scored('youtube', 'https://youtube.com/@unrelated', 'rejected', 'the profile page did not carry enough identity evidence'),
        ],
        fetches: 1,
        prefilted: [],
      });

      const ctx = context();
      await stage.run(ctx);

      expect(prisma.socialProfile.create).toHaveBeenCalledTimes(1);
      expect(prisma.socialProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ platform: 'github', verificationStatus: 'VERIFIED' }) }),
      );
      expect(ctx.notes.join(' ')).toContain('rejected 1 candidate(s)');
    });

    it('updates the existing row instead of duplicating it on a re-run', async () => {
      presenceDiscovery.crawl.mockResolvedValue({ accounts: [account('github', 'northwind')], pagesFetched: 4 });
      verification.scoreAll.mockResolvedValue({ scored: [scored('github', 'https://github.com/northwind', 'verified')], fetches: 1, prefilted: [] });
      prisma.socialProfile.findFirst.mockResolvedValue({ id: 'existing-1' });

      await stage.run(context());

      expect(prisma.socialProfile.create).not.toHaveBeenCalled();
      expect(prisma.socialProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'existing-1' } }),
      );
    });

    it('records a person’s profile without storing it as company presence', async () => {
      const personal = { ...account('github', 'jordan-blake'), entity: 'personal' as const };
      presenceDiscovery.crawl.mockResolvedValue({ accounts: [personal], pagesFetched: 4 });
      verification.scoreAll.mockResolvedValue({ scored: [scored('github', 'https://github.com/jordan-blake', 'probable')], fetches: 1, prefilted: [] });

      const ctx = context();
      await stage.run(ctx);

      expect(prisma.socialProfile.create).not.toHaveBeenCalled();
      expect(ctx.notes.join(' ')).toContain('person');
    });

    it('reports candidates the pre-filter dropped rather than hiding them', async () => {
      presenceDiscovery.crawl.mockResolvedValue({ accounts: [], pagesFetched: 4 });
      verification.scoreAll.mockResolvedValue({
        scored: [],
        fetches: 0,
        prefilted: [{ platform: 'instagram', url: 'https://instagram.com/maybe' }],
      });

      const ctx = context();
      await stage.run(ctx);

      expect(ctx.notes.join(' ')).toContain('below the name-similarity floor');
      expect(ctx.notes.join(' ')).toContain('Not finding an account is the honest outcome');
    });
  });

  describe('identity passed to the scorer', () => {
    it('reads headquarters from validated first-party facts only', async () => {
      presenceDiscovery.crawl.mockResolvedValue({ accounts: [], pagesFetched: 0 });
      verification.scoreAll.mockResolvedValue({ scored: [], fetches: 0, prefilted: [] });

      const ctx = context({
        facts: [
          fact('headquarters', 'Austin, Texas', 0.9, true, 'first_party'),
          fact('headquarters', 'Somewhere Else', 0.95, true, 'external'),
          fact('headquarters', 'Unvalidated Place', 0.99, false, 'first_party'),
        ],
      });
      await stage.run(ctx);

      expect(verification.scoreAll).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ location: 'Austin, Texas' }),
        expect.any(Number),
      );
    });
  });
});

function fact(
  field: string,
  value: string,
  confidence: number,
  validated: boolean,
  sourceType: 'first_party' | 'external',
) {
  return {
    field,
    value,
    factType: 'explicit' as const,
    confidence,
    sources: [],
    sourceType,
    validated,
    validationNote: null,
  } as never;
}
