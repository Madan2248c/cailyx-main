import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../../test/mocks/prisma.mock.js';
import { CATEGORY_FIELDS, CATEGORY_WEIGHTS } from '../../discovery.constants.js';
import type { CategorySummary, CompanyContextProfileJson, FactField, FactValue, ReconciledFact } from '../../discovery.types.js';
import { RunBudget, type DiscoveryRunContext } from '../pipeline-context.js';
import { CompileStage } from './compile.stage.js';

/**
 * Compile is the module's output contract: whatever is wrong here is wrong in
 * every later module that reads a profile. So these tests check the shape a
 * consumer depends on (every material field evidence-bearing, every evidence's
 * `source_id` resolvable in `sources[]`), the scores, and the identity rule.
 */

describe('CompileStage', () => {
  let stage: CompileStage;
  let prisma: PrismaMock;

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
    } as unknown as DiscoveryRunContext & { notes: string[] };
  }

  /** Every category complete except the ones named. */
  function summariesAllCompleteExcept(missing: string[] = []): CategorySummary[] {
    return Object.entries(CATEGORY_FIELDS).map(([category, fields]) => ({
      category,
      summary: `${category} summary.`,
      // Empty list = "no canonical filtering" (see applyCanonicalValues), which is
      // what a fixture that does not care about the cleaned value list wants.
      facts: [],
      missingFields: missing.includes(category) ? (fields as FactField[]) : [],
      conflictNotes: [],
    }));
  }

  function page(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'page-1',
      url: 'https://northwind.io/',
      pageType: 'HOMEPAGE',
      fetchStatus: 'FETCHED',
      contentHash: 'hash-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      pipelineState: {
        title: 'Northwind Analytics',
        description: 'Data analytics for mid-market teams.',
        purposeCategory: 'homepage',
        fetchedAt: '2026-01-01T00:00:00Z',
        selected: true,
        extractStatus: 'done',
      },
      ...overrides,
    };
  }

  /** The captured `companyContextProfile.create` payload. */
  function createdProfile(): { profileJson: CompanyContextProfileJson; version: number; overallCompleteness: number; overallConfidence: number } {
    const call = prisma.companyContextProfile.create.mock.calls[0][0] as {
      data: { profileJson: CompanyContextProfileJson; version: number; overallCompleteness: number; overallConfidence: number };
    };
    return call.data;
  }

  beforeEach(async () => {
    prisma = createPrismaMock();

    const moduleRef = await Test.createTestingModule({
      providers: [CompileStage, { provide: PrismaService, useValue: asPrismaService(prisma) }],
    }).compile();

    stage = moduleRef.get(CompileStage);

    prisma.discoveryRun.findUnique.mockResolvedValue({ startedAt: new Date('2026-01-01T00:00:00Z') });
    prisma.discoveredPage.findMany.mockResolvedValue([page()]);
    prisma.socialProfile.findMany.mockResolvedValue([]);
    prisma.companyContextProfile.findFirst.mockResolvedValue(null);
    prisma.companyContextProfile.create.mockResolvedValue({ id: 'profile-1' });
  });

  describe('the output contract', () => {
    it('emits every material field in evidence-bearing shape', async () => {
      const ctx = context({
        facts: [fact('services', 'Data engineering', 'homepage'), fact('icp', 'Mid-market teams', 'homepage')],
        summaries: summariesAllCompleteExcept(),
      });

      await stage.run(ctx);
      const profile = createdProfile().profileJson;

      // Arrays are arrays of objects, never bare strings.
      expect(profile.offerings.services).toHaveLength(1);
      expect(profile.offerings.services[0]).toMatchObject({
        value: 'Data engineering',
        status: 'supported',
        fact_type: 'explicit',
      });
      expect(profile.offerings.services[0].fact_id).toMatch(/^fact-/);
      // A scalar backed by a category summary carries the synthesis, not the raw
      // fact — the synthesis is what the schema's field is for.
      expect(profile.customers.icp_summary).toMatchObject({ value: 'customers summary.', fact_type: 'strong_inference' });

      // Scalars with no fact are null, not invented.
      expect(profile.identity.legal_name).toBeNull();
      expect(profile.offerings.pricing_model).toBeNull();
    });

    it('resolves every evidence source_id into the sources[] registry', async () => {
      const ctx = context({
        facts: [fact('services', 'Data engineering', 'homepage'), fact('valueProps', 'Fast', 'service')],
        summaries: summariesAllCompleteExcept(),
      });
      prisma.discoveredPage.findMany.mockResolvedValue([
        page(),
        page({ id: 'page-2', url: 'https://northwind.io/services', pageType: 'SERVICE' }),
      ]);

      await stage.run(ctx);
      const profile = createdProfile().profileJson;

      const registryIds = new Set(profile.sources.map((s) => s.source_id));
      expect(registryIds.size).toBeGreaterThan(0);

      const everyEvidence = [
        ...profile.offerings.services,
        ...profile.positioning.value_propositions,
        ...profile.identity.brands,
      ].flatMap((value: FactValue) => value.evidence);

      expect(everyEvidence.length).toBeGreaterThan(0);
      for (const evidence of everyEvidence) {
        expect(registryIds.has(evidence.source_id)).toBe(true);
      }
      // The registry knows which URL each id points at.
      const url = profile.sources.find((s) => s.source_id === everyEvidence[0].source_id)?.url;
      expect(url).toBe(everyEvidence[0].source_url);
    });

    it('registers a page that failed to fetch as an inaccessible source', async () => {
      prisma.discoveredPage.findMany.mockResolvedValue([
        page(),
        page({ id: 'page-2', url: 'https://northwind.io/pricing', fetchStatus: 'FAILED' }),
      ]);

      await stage.run(context({ facts: [], summaries: [] }));

      const failed = createdProfile().profileJson.sources.find((s) => s.url === 'https://northwind.io/pricing');
      expect(failed).toMatchObject({ accessible: false });
    });

    it('reports the run’s research metadata honestly', async () => {
      prisma.discoveredPage.findMany.mockResolvedValue([
        page(),
        page({ id: 'page-2', url: 'https://northwind.io/services' }),
        page({ id: 'page-3', url: 'https://northwind.io/blog', pipelineState: { selected: false, extractStatus: 'pending' } }),
      ]);

      await stage.run(context({ facts: [], summaries: [], search: { queriesRun: 4, costUsd: 0.02, fieldsSearched: ['g2'] } }));
      const meta = createdProfile().profileJson.research_metadata;

      expect(meta.pages_discovered).toBe(3);
      expect(meta.pages_fetched).toBe(3);
      expect(meta.pages_analyzed).toBe(2);
      expect(meta.external_queries_run).toBe(4);
      expect(meta.profile_version).toBe('1');
      expect(meta.completed_at).toBeTruthy();
    });

    it('carries consolidate’s missing fields and conflicts through', async () => {
      const summaries = summariesAllCompleteExcept(['credibility']);
      summaries[0].conflictNotes = ['sources disagree on the legal name'];

      await stage.run(context({ facts: [], summaries }));

      const profile = createdProfile().profileJson;
      expect(profile.missing_fields).toEqual(
        CATEGORY_FIELDS.credibility.map((field) => ({ field, category: 'credibility', note: null })),
      );
      expect(profile.conflicts.some((c) => c.note === 'sources disagree on the legal name')).toBe(true);
    });

    it('compiles only validated facts', async () => {
      const ctx = context({
        facts: [fact('services', 'Kept', 'homepage'), { ...fact('services', 'Dropped', 'homepage'), validated: false }],
        summaries: summariesAllCompleteExcept(),
      });

      await stage.run(ctx);

      expect(createdProfile().profileJson.offerings.services.map((s) => s.value)).toEqual(['Kept']);
    });

    // Consolidation is the only stage that sees every value for a field at once,
    // so its cleaned list decides which of them reach the profile. This is what
    // keeps a marketing heading the deterministic pass picked up ("Integrate
    // tonight") and three phrasings of one claim out of the output.
    it('drops values consolidate’s cleaned list left out', async () => {
      const summaries = summariesAllCompleteExcept();
      const offerings = summaries.find((s) => s.category === 'offerings')!;
      offerings.facts = ['Data engineering'];

      const ctx = context({
        facts: [
          fact('services', 'Data engineering', 'homepage'),
          fact('services', 'Integrate tonight', 'homepage'),
          fact('outcomes', 'Faster time to inbox', 'homepage'),
        ],
        summaries,
      });

      await stage.run(ctx);

      expect(createdProfile().profileJson.offerings.services.map((s) => s.value)).toEqual(['Data engineering']);
      // A field the cleaned list does not cover is untouched — the list is only
      // authoritative for the fields it actually speaks about.
      expect(createdProfile().profileJson.positioning.outcomes_promised.map((s) => s.value)).toEqual([
        'Faster time to inbox',
      ]);
    });

    it('never filters the identity fields, whatever the cleaned list says', async () => {
      const summaries = summariesAllCompleteExcept();
      // An empty identity list would mean "drop everything" if the filter applied
      // to identity — it must not, or a sloppy model could cost the profile its
      // name.
      summaries.find((s) => s.category === 'identity')!.facts = [];

      await stage.run(
        context({ facts: [fact('brand', 'Northwind Analytics', 'homepage')], summaries }),
      );

      expect(createdProfile().profileJson.identity.business_name?.value).toBe('Northwind Analytics');
    });

    it('caps a long service list', async () => {
      const many = Array.from({ length: 40 }, (_, i) => fact('services', `Service ${i}`, 'homepage'));
      await stage.run(context({ facts: many, summaries: summariesAllCompleteExcept() }));

      expect(createdProfile().profileJson.offerings.services).toHaveLength(25);
    });

    it('keeps only ISO-3166 country codes in geography', async () => {
      const ctx = context({
        facts: [fact('markets', 'US', 'homepage'), fact('markets', 'United States', 'homepage'), fact('markets', 'GB', 'homepage')],
        summaries: summariesAllCompleteExcept(),
      });

      await stage.run(ctx);

      expect(createdProfile().profileJson.geography.countries.map((c) => c.value).sort()).toEqual(['GB', 'US']);
    });
  });

  describe('completeness', () => {
    it('scores the tuned weighted average', async () => {
      // identity and offerings complete, everything else wholly missing, no social.
      const summaries = Object.entries(CATEGORY_FIELDS).map(([category, fields]) => ({
        category,
        summary: '',
        facts: [],
        missingFields: category === 'identity' || category === 'offerings' ? [] : (fields as FactField[]),
        conflictNotes: [],
      }));

      await stage.run(context({ facts: [], summaries }));

      const expected = CATEGORY_WEIGHTS.identity + CATEGORY_WEIGHTS.offerings;
      expect(createdProfile().overallCompleteness).toBeCloseTo(expected, 3);
    });

    it('scores digital_presence as binary', async () => {
      const summaries = Object.entries(CATEGORY_FIELDS).map(([category, fields]) => ({
        category,
        summary: '',
        facts: [],
        missingFields: fields as FactField[],
        conflictNotes: [],
      }));
      prisma.socialProfile.findMany.mockResolvedValue([
        { platform: 'github', url: 'https://github.com/northwind', score: 90, verificationStatus: 'VERIFIED' },
      ]);

      await stage.run(context({ facts: [], summaries }));

      // One asserted profile is full presence, not a partial score.
      expect(createdProfile().overallCompleteness).toBeCloseTo(CATEGORY_WEIGHTS.digital_presence, 3);
    });

    it('treats a category with no summary at all as wholly missing', async () => {
      await stage.run(context({ facts: [], summaries: [] }));

      expect(createdProfile().overallCompleteness).toBe(0);
    });
  });

  describe('identity', () => {
    it('is unknown when the site declared no name', async () => {
      await stage.run(context({ facts: [], summaries: [] }));

      const companyType = createdProfile().profileJson.identity.company_type as FactValue;
      expect(companyType.value).toBe('unknown');
      expect(companyType.confidence).toBe(0.2);
    });

    it('is company with a legal name', async () => {
      await stage.run(context({ facts: [fact('legalName', 'Northwind Analytics LLC', 'about')], summaries: [] }));

      const companyType = createdProfile().profileJson.identity.company_type as FactValue;
      expect(companyType.value).toBe('company');
      expect(companyType.confidence).toBe(0.8);
    });

    it('flags a declared identity that shares no word with the project on record', async () => {
      // Plausibly a subsidiary or a product microsite — flagged, not guessed.
      await stage.run(
        context({
          facts: [fact('legalName', 'Vertex Holdings Ltd', 'about'), fact('alternateName', 'Vertex', 'about')],
          summaries: [],
        }),
      );

      const companyType = createdProfile().profileJson.identity.company_type as FactValue;
      expect(companyType.value).toBe('subsidiary');
      expect(companyType.confidence).toBe(0.5);
    });

    it('emits the project’s own name and domain with no borrowed evidence', async () => {
      await stage.run(context({ facts: [], summaries: [] }));

      const profile = createdProfile().profileJson;
      expect(profile.identity.business_name).toMatchObject({ value: 'Northwind Analytics', evidence: [] });
      expect(profile.identity.primary_domain).toMatchObject({ value: 'northwind.io', evidence: [] });
    });
  });

  describe('digital presence', () => {
    it('buckets platforms by group and drops a person’s profiles', async () => {
      prisma.socialProfile.findMany.mockResolvedValue([
        { platform: 'linkedin', url: 'https://linkedin.com/company/northwind', score: 65, verificationStatus: 'PROBABLE' },
        { platform: 'github', url: 'https://github.com/northwind', score: 90, verificationStatus: 'VERIFIED' },
        { platform: 'medium', url: 'https://medium.com/@northwind', score: 60, verificationStatus: 'PROBABLE' },
        { platform: 'scholar', url: 'https://scholar.google.com/citations?user=x', score: 60, verificationStatus: 'PROBABLE' },
      ]);

      await stage.run(context({ facts: [], summaries: [] }));
      const presence = createdProfile().profileJson.digital_presence;

      expect(presence.social_profiles.map((p) => p.value)).toEqual(['https://linkedin.com/company/northwind']);
      expect(presence.developer_profiles.map((p) => p.value)).toEqual(['https://github.com/northwind']);
      expect(presence.content_channels.map((p) => p.value)).toEqual(['https://medium.com/@northwind']);
      // A person's profile is not company presence.
      const all = Object.values(presence).flat().map((p) => p.value);
      expect(all).not.toContain('https://scholar.google.com/citations?user=x');
    });

    it('only asserts profiles the pipeline would stand behind', async () => {
      await stage.run(context({ facts: [], summaries: [] }));

      // `possible` candidates stay in the table for a human, but never reach the
      // profile as stated facts.
      expect(prisma.socialProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ verificationStatus: { in: ['VERIFIED', 'PROBABLE'] } }),
        }),
      );
    });
  });

  describe('persistence', () => {
    it('versions the profile from the project’s previous one and updates the run', async () => {
      prisma.companyContextProfile.findFirst.mockResolvedValue({ version: 3 });

      await stage.run(context({ facts: [], summaries: [] }));

      expect(createdProfile().version).toBe(4);
      expect(prisma.discoveryRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'run-1' },
          data: expect.objectContaining({ profileVersion: 4 }),
        }),
      );
    });

    it('reports the Definition-of-Done gates as notes', async () => {
      const ctx = context({ facts: [], summaries: [] });
      await stage.run(ctx);

      // No legal name or brand → identity confidence 0.2, below the 0.80 floor.
      expect(ctx.notes.join(' ')).toContain('below the 0.8 floor');
    });
  });
});

/** A validated fact sourced from a page that exists in the run's page rows. */
function fact(field: string, value: string, sourceUrl: string): ReconciledFact {
  return {
    field,
    value,
    factType: 'explicit',
    confidence: 0.8,
    sources: [
      {
        url: sourceUrl === 'homepage' ? 'https://northwind.io/' : `https://northwind.io/${sourceUrl}`,
        pageType: 'homepage',
        excerpt: value,
        fetchedAt: '2026-01-01T00:00:00Z',
        contentHash: 'hash-1',
      },
    ],
    sourceType: 'first_party',
    validated: true,
    validationNote: null,
  } as ReconciledFact;
}
