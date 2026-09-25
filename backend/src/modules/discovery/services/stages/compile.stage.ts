/**
 * Compile stage — assembles the stored company-context profile from everything
 * the run validated, and writes the `company_context_profiles` row.
 *
 * Ported from the old repo's `aeo-context.service.ts` `compile` (lines
 * 2002–2332): the value caps, the `byField`/`singular` dedup rules, the
 * conservative `company_type` heuristic and the weighted completeness scorer
 * are that code's, unchanged. What is different is the **output schema**: the
 * old code wrote a flat `SiteContextData`, this writes the spec doc's "Final
 * Enriched Company-Context Schema" (see `CompanyContextProfileJson`), where
 * every material field is an evidence-bearing object rather than a bare string.
 *
 * Only facts that passed validation are compiled — an unvalidated fact is not
 * mentioned in the profile at all (the old code's `where: { validated: true }`).
 *
 * ## Where a fact goes
 *
 * The spec schema's field names do not line up one-for-one with the pipeline's
 * `FactField` vocabulary, so each fact is placed in its best-fitting schema
 * field. The placements that are not obvious — and the schema fields this
 * pipeline has no source for at all, which stay honestly empty — are documented
 * on {@link CompileStage.buildSections} and in
 * docs/analysis/discovery.md rather than being filled with something plausible.
 *
 * No LLM call happens here, and the char budget is untouched: compile is a
 * deterministic assembly over already-validated facts.
 *
 * @module compile.stage
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  CANONICAL_VALUE_FIELDS,
  CATEGORY_FIELDS,
  CATEGORY_WEIGHTS,
  DIGITAL_PRESENCE_ABSENT,
  DIGITAL_PRESENCE_CATEGORY,
  DIGITAL_PRESENCE_PRESENT,
  FACT_TYPE_BASE,
  IDENTITY_CONFIDENCE_FLOOR,
  REACHABLE_PAGES_FLOOR,
} from '../../discovery.constants.js';
import { readPageState } from '../../discovery.types.js';
import type {
  ArrayField,
  CategorySummary,
  CompanyContextProfileJson,
  FactField,
  FactSource,
  FactValue,
  MissingFieldEntry,
  ProfileConflict,
  ReconciledFact,
  ScalarField,
  SourceRegistryEntry,
  SourceType,
} from '../../discovery.types.js';
import type { DiscoveryRunContext } from '../pipeline-context.js';
import { PLATFORM_GROUP } from '../presence.types.js';
import type { PresencePlatform } from '../presence.types.js';
import { PrismaService } from '../../../../prisma/prisma.service.js';
import type { Prisma } from '../../../../generated/prisma/client.js';

/** Value caps, ported from the old code's `compile`. */
const CAPS = {
  services: 25,
  icp: 10,
  valueProps: 10,
  painPoints: 12,
  outcomes: 12,
  markets: 5,
  /** Everything the old code put in its "expanded" fact bag. */
  expanded: 10,
} as const;

/** Per-fact evidence quotes kept, and their length — evidence, not the full page. */
const MAX_EVIDENCE_PER_FACT = 5;
const MAX_QUOTE_CHARS = 300;

/** A page or search source, resolved to a stable registry id. */
interface SourceLookup {
  entries: SourceRegistryEntry[];
  idByUrl: Map<string, string>;
}

/** Allocates the run's stable `fact-…` / `evidence-…` / `source-…` identifiers. */
interface IdAllocator {
  factCount: Map<string, number>;
  evidenceCount: number;
}

@Injectable()
export class CompileStage {
  private readonly logger = new Logger(CompileStage.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(ctx: DiscoveryRunContext): Promise<void> {
    const allFacts = ctx.state.facts ?? [];
    const summaries = ctx.state.summaries ?? [];
    const facts = this.applyCanonicalValues(
      allFacts.filter((f) => f.validated),
      summaries,
    );

    const run = await this.prisma.discoveryRun.findUnique({
      where: { id: ctx.runId },
      select: { startedAt: true },
    });
    const pages = await this.prisma.discoveredPage.findMany({
      where: { discoveryRunId: ctx.runId },
      orderBy: { url: 'asc' },
    });
    // Only asserted profiles reach the profile: `possible` candidates are
    // unverified hints a human should look at, and they stay queryable in
    // `social_profiles` rather than being stated as facts here.
    const social = await this.prisma.socialProfile.findMany({
      where: { projectId: ctx.project.id, verificationStatus: { in: ['VERIFIED', 'PROBABLE'] } },
      orderBy: { platform: 'asc' },
    });

    const previous = await this.prisma.companyContextProfile.findFirst({
      where: { projectId: ctx.project.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (previous?.version ?? 0) + 1;

    const now = new Date().toISOString();
    const registry = this.buildSourceRegistry(pages, facts);
    const ids: IdAllocator = { factCount: new Map(), evidenceCount: 0 };
    const sections = this.buildSections(ctx, facts, pages, social, registry, ids, now);

    const { completeness, overallCompleteness } = this.scoreCompleteness(summaries, social.length > 0);
    const overallConfidence = this.scoreConfidence(facts, sections.identity.company_type);

    const pagesFetched = pages.filter((p) => p.fetchStatus === 'FETCHED');
    const pagesAnalyzed = pages.filter((p) => readPageState(p.pipelineState).extractStatus === 'done');

    const profile: CompanyContextProfileJson = {
      ...sections,
      sources: registry.entries,
      conflicts: this.buildConflicts(facts, summaries),
      missing_fields: this.buildMissingFields(summaries),
      research_metadata: {
        started_at: (run?.startedAt ?? new Date()).toISOString(),
        completed_at: now,
        // "When the synthesis was last checked against its evidence." The verify
        // stage runs on every run that produced summaries, and its failures are
        // reported as notes rather than silently skipped — so the honest value
        // is the completion time whenever there was anything to verify.
        last_verified_at: summaries.length > 0 ? now : null,
        pages_discovered: pages.length,
        pages_fetched: pagesFetched.length,
        pages_analyzed: pagesAnalyzed.length,
        external_queries_run: ctx.state.search?.queriesRun ?? 0,
        overall_confidence: overallConfidence,
        overall_completeness: overallCompleteness,
        profile_version: String(version),
      },
    };

    await this.prisma.companyContextProfile.create({
      data: {
        projectId: ctx.project.id,
        discoveryRunId: ctx.runId,
        profileJson: profile as unknown as Prisma.InputJsonValue,
        overallConfidence,
        overallCompleteness,
        version,
      },
    });

    await this.prisma.discoveryRun.update({
      where: { id: ctx.runId },
      data: { overallConfidence, overallCompleteness, profileVersion: version },
    });

    await this.reportDefinitionOfDone(ctx, sections, pagesAnalyzed.length, pagesFetched.length);

    // The per-category breakdown has no column of its own — the approved schema
    // keeps only the weighted `overall_completeness` — so it is logged rather
    // than silently computed and dropped. When a category looks wrong, this is
    // where the number that moved is.
    this.logger.debug(
      `Category completeness for run ${ctx.runId}: ` +
        Object.entries(completeness)
          .map(([category, value]) => `${category}=${value.toFixed(2)}`)
          .join(', '),
    );

    this.logger.log(
      `Company context compiled for ${ctx.project.domain}: ${sections.offerings.services.length} services, ` +
        `${sections.customers.icp_summary ? 'an ICP summary' : 'no ICP summary'}, ` +
        `${pagesAnalyzed.length}/${pagesFetched.length} fetched pages analyzed, version ${version}, run ${ctx.runId}`,
    );
  }

  // ─── Sections ───────────────────────────────────────────────────────────

  /**
   * Keep only the values consolidate's canonical list kept, for the fields where
   * a list-level clean-up is safe (see `CANONICAL_VALUE_FIELDS`).
   *
   * This is where the profile stops carrying marketing copy as an offering and
   * three phrasings of one claim as three claims: consolidation is the only
   * stage that sees every value for a field at once, so its cleaned list is the
   * authority for those fields. Values are matched case-insensitively but never
   * rewritten, so each surviving value still maps to the facts (and therefore
   * the evidence) it came from.
   *
   * A category whose list came back **empty** is treated as "no canonical list"
   * rather than "drop everything": a model that omits the list entirely would
   * otherwise silently empty a whole category of the profile, which is a far
   * worse failure than carrying one noisy value. The only path that can produce
   * an empty list is a model that dropped every value deliberately; the residual
   * risk is accepted in that direction on purpose.
   */
  private applyCanonicalValues(facts: ReconciledFact[], summaries: CategorySummary[]): ReconciledFact[] {
    const allowedByField = new Map<FactField, Set<string>>();
    for (const summary of summaries) {
      const fields = CATEGORY_FIELDS[summary.category];
      // `?? []` because a run that paused before this list existed keeps its
      // summaries in `pipeline_state` — an in-flight run must not break on a
      // field its own stage never wrote.
      const canonical = summary.facts ?? [];
      if (!fields || canonical.length === 0) continue;
      for (const field of fields) {
        if (!CANONICAL_VALUE_FIELDS.has(field)) continue;
        const allowed = allowedByField.get(field) ?? new Set<string>();
        for (const value of canonical) allowed.add(value.toLowerCase());
        allowedByField.set(field, allowed);
      }
    }
    if (allowedByField.size === 0) return facts;
    return facts.filter((fact) => {
      const allowed = allowedByField.get(fact.field);
      return allowed === undefined || allowed.has(fact.value.toLowerCase());
    });
  }

  /**
   * Place every validated fact into the spec schema.
   *
   * Placements that are not one-for-one with the pipeline's fields:
   * - `category` (what the company *is*) → `descriptions.one_line`, the closest
   *   thing the schema has to "the company in a phrase". It is a supported fact
   *   moved to its best-fitting slot, never a synthesised sentence.
   * - `vertical` (the industry the company sells *into*) → `customers.industries`.
   * - `markets` (ISO-3166 alpha-2 only, as the extraction contract requires) →
   *   `geography.countries`. `service_areas` stays empty: nothing in the
   *   pipeline distinguishes a named service area from a country code.
   * - `technology` (technology signals found in copy) → `technology_signals`.
   *   `integrations`/`platforms_supported` stay empty — the pipeline does not
   *   separate an integration from any other technology mention.
   * - `contact` → `organization.contact_details`; `headquarters` and
   *   `officeLocation` → `geography.headquarters` / `geography.offices`.
   * - `case_studies` is the one section filled from **pages** rather than facts:
   *   a selected `case-study` page is itself the evidence that the claim exists,
   *   and the schema has no fact field for it. Value is the page title (its URL
   *   when untitled), citing that page.
   * - `digital_presence` comes from the `social_profiles` table, bucketed by the
   *   platform's group: personal-profile platforms are excluded outright
   *   (`presence.types.ts` is explicit that a person's profile is not part of
   *   the company footprint), GitHub is a developer profile, app stores are app
   *   profiles, publishing platforms are content channels, and directories,
   *   review sites and marketplaces are community links.
   *
   * Fields the pipeline has **no source for** are left empty rather than filled
   * with a guess — `products`, `solutions`, `packages`, `delivery_model`,
   * `pricing_details`, `free_trial`, `demo_available`, `key_messages`,
   * `claims_and_proof`, `company_sizes`, `buyer_roles`, `user_roles`,
   * `use_cases`, `named_customers`, `customer_examples`, `regions`,
   * `remote_or_local_delivery`, `sales_motion`, `self_serve`, `primary_ctas`,
   * `distribution_channels`, `marketplaces`, `testimonials`,
   * `security_and_compliance`, `review_profiles`, `ratings`, `founders`,
   * `team_members`, `team_size`, `hiring_areas`, `api_available`, and the
   * identity fields for parent/subsidiary structure and related domains. They
   * surface as `missing_fields` entries, which is the schema's own way of
   * saying "not found" — the alternative would be inventing them.
   */
  private buildSections(
    ctx: DiscoveryRunContext,
    facts: ReconciledFact[],
    pages: PageRow[],
    social: SocialRow[],
    registry: SourceLookup,
    ids: IdAllocator,
    now: string,
  ): Omit<CompanyContextProfileJson, 'sources' | 'conflicts' | 'missing_fields' | 'research_metadata'> {
    const array = (field: FactField, cap: number): ArrayField =>
      this.values(facts, field, cap).map((f) => this.toFactValue(f, registry, ids, now));
    const scalar = (field: FactField): ScalarField => {
      const best = this.mostCited(facts, field);
      return best ? this.toFactValue(best, registry, ids, now) : null;
    };

    // The project's own on-record name and domain are not facts from the site —
    // they are what we already knew before crawling. They are still emitted in
    // evidence-bearing shape (with no page evidence) so a reader can tell a
    // project-record value from a site-sourced one by its empty `evidence`.
    const brandFacts = this.values(facts, 'brand', CAPS.expanded);
    const businessName = brandFacts[0] ?? null;
    const identity = this.resolveIdentity(facts, ctx.project.name.trim().toLowerCase());

    const markets = this.values(facts, 'markets', CAPS.markets)
      .map((f) => f.value.trim())
      .filter((m) => /^[A-Z]{2}$/.test(m));

    const caseStudies = this.caseStudyValues(pages, registry, ids, now);
    const logo = this.logoValue(pages, registry, ids, now);

    const description = this.mostCited(facts, 'description');

    return {
      identity: {
        business_name: businessName
          ? this.toFactValue(businessName, registry, ids, now)
          : this.projectRecordValue(ctx.project.name, now, ids),
        legal_name: scalar('legalName'),
        alternate_names: array('alternateName', CAPS.expanded),
        brands: brandFacts.length > 0 ? array('brand', CAPS.expanded) : [this.projectRecordValue(ctx.project.name, now, ids)],
        company_type: this.identityTypeValue(identity, registry, ids, now),
        parent_company: null,
        subsidiaries: [],
        founded_year: scalar('foundedYear'),
        primary_domain: this.projectRecordValue(ctx.project.domain, now, ids),
        related_domains: [],
        logo_url: logo,
      },
      descriptions: {
        // `category` is the pipeline's "what this company is" fact; the schema's
        // one-line description is its natural home.
        one_line: scalar('category'),
        short: this.summaryValue(ctx, 'descriptions', registry, ids, now),
        detailed: description ? this.toFactValue(description, registry, ids, now) : this.homepageDescription(pages, registry, ids, now),
      },
      offerings: {
        products: [],
        services: array('services', CAPS.services),
        solutions: [],
        packages: [],
        delivery_model: null,
        pricing_model: scalar('pricingModel'),
        pricing_details: [],
        free_trial: null,
        demo_available: null,
      },
      positioning: {
        value_propositions: array('valueProps', CAPS.valueProps),
        differentiators: array('differentiator', CAPS.expanded),
        problems_solved: array('painPoints', CAPS.painPoints),
        outcomes_promised: array('outcomes', CAPS.outcomes),
        key_messages: [],
        claims_and_proof: [],
      },
      customers: {
        icp_summary: this.summaryValue(ctx, 'customers', registry, ids, now) ?? scalar('icp'),
        company_sizes: [],
        industries: array('vertical', CAPS.expanded),
        buyer_roles: [],
        user_roles: [],
        use_cases: [],
        named_customers: [],
        customer_examples: [],
      },
      geography: {
        headquarters: scalar('headquarters'),
        offices: array('officeLocation', CAPS.expanded),
        service_areas: [],
        countries: markets.map((m) => this.plainValue(m, 'explicit', FACT_TYPE_BASE.explicit, now, ids)),
        regions: [],
        languages: array('languages', CAPS.expanded),
        remote_or_local_delivery: null,
      },
      go_to_market: {
        business_model: scalar('businessModel'),
        sales_motion: null,
        self_serve: null,
        primary_ctas: [],
        distribution_channels: [],
        partners: array('partner', CAPS.expanded),
        marketplaces: [],
      },
      credibility: {
        case_studies: caseStudies,
        testimonials: [],
        awards: array('award', CAPS.expanded),
        certifications: array('certification', CAPS.expanded),
        security_and_compliance: [],
        review_profiles: [],
        ratings: [],
      },
      organization: {
        founders: [],
        leadership: array('leadership', CAPS.expanded),
        team_members: [],
        team_size: null,
        hiring_areas: [],
        contact_details: array('contact', CAPS.expanded),
      },
      digital_presence: this.digitalPresence(social, now, ids),
      technology: {
        integrations: [],
        platforms_supported: [],
        api_available: null,
        technology_signals: array('technology', CAPS.services),
      },
    };
  }

  // ─── Fact selection (ported from the old code's byField/singular) ────────

  /** Deduped by value, first `cap` kept — the old code's `byField`. */
  private values(facts: ReconciledFact[], field: FactField, cap: number): ReconciledFact[] {
    const out: ReconciledFact[] = [];
    const seen = new Set<string>();
    for (const f of facts.filter((x) => x.field === field)) {
      const key = f.value.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(f);
      if (out.length >= cap) break;
    }
    return out;
  }

  /** The most-cited value for a field — the old code's `singular`. Ties keep the first seen. */
  private mostCited(facts: ReconciledFact[], field: FactField): ReconciledFact | null {
    const counts = new Map<string, { fact: ReconciledFact; n: number }>();
    for (const f of facts.filter((x) => x.field === field)) {
      const key = f.value.trim().toLowerCase();
      if (!key) continue;
      const entry = counts.get(key) ?? { fact: f, n: 0 };
      entry.n++;
      counts.set(key, entry);
    }
    let best: { fact: ReconciledFact; n: number } | null = null;
    for (const c of counts.values()) if (!best || c.n > best.n) best = c;
    return best?.fact ?? null;
  }

  // ─── Value builders ─────────────────────────────────────────────────────

  private toFactValue(fact: ReconciledFact, registry: SourceLookup, ids: IdAllocator, now: string): FactValue {
    const factId = this.nextFactId(ids, fact.field);
    const evidence = fact.sources
      .slice(0, MAX_EVIDENCE_PER_FACT)
      .map((source) => this.toEvidenceItem(source, fact.sourceType, registry, ids))
      .filter((e): e is EvidenceValue => e !== null);

    return {
      fact_id: factId,
      value: fact.value,
      // An external (search-sourced) fact that cleared the same verbatim check is
      // supported too — it is simply capped in confidence, never promoted to
      // first-party standing.
      status: 'supported',
      fact_type: fact.factType,
      confidence: fact.confidence,
      last_checked_at: now,
      evidence_ids: evidence.map((e) => e.evidence_id),
      evidence,
    };
  }

  /** A value that came from the project record, not from the site — no page to cite. */
  private projectRecordValue(value: string, now: string, ids: IdAllocator): FactValue {
    return this.plainValue(value, 'explicit', 1, now, ids);
  }

  /**
   * A value with no page evidence behind it (a project-record field, a country
   * code lifted from an already-evidenced `markets` fact, a derived
   * `company_type`). Kept evidence-free rather than borrowing a citation it
   * does not have.
   */
  private plainValue(value: string, factType: FactValue['fact_type'], confidence: number, now: string, ids: IdAllocator): FactValue {
    return {
      fact_id: this.nextFactId(ids, 'value'),
      value,
      status: 'supported',
      fact_type: factType,
      confidence,
      last_checked_at: now,
      evidence_ids: [],
      evidence: [],
    };
  }

  /** The consolidate stage's prose summary for a category, carrying that category's facts as evidence. */
  private summaryValue(
    ctx: DiscoveryRunContext,
    category: string,
    registry: SourceLookup,
    ids: IdAllocator,
    now: string,
  ): ScalarField {
    const summary = (ctx.state.summaries ?? []).find((s) => s.category === category);
    if (!summary || summary.summary.trim().length === 0) {
      // No summary text — fall back to the strongest single fact if there is
      // one, so the field is not empty when the evidence supported something.
      const fields = CATEGORY_FIELDS[category] ?? [];
      for (const field of fields) {
        const best = this.mostCited(ctx.state.facts ?? [], field);
        if (best) return this.toFactValue(best, registry, ids, now);
      }
      return null;
    }

    const evidence = this.categoryFacts(ctx, category)
      .slice(0, MAX_EVIDENCE_PER_FACT)
      .map((f) => this.toEvidenceItem(f.sources[0], f.sourceType, registry, ids))
      .filter((e): e is EvidenceValue => e !== null);
    const confidence = this.averageConfidence(this.categoryFacts(ctx, category)) ?? 0.5;

    return {
      fact_id: this.nextFactId(ids, category),
      value: summary.summary,
      status: 'supported',
      // A summary is a synthesis of supported facts, not an inference from
      // nothing — but it is not a verbatim site claim either, so it keeps the
      // aggregate confidence of what it was built from.
      fact_type: 'strong_inference',
      confidence,
      last_checked_at: now,
      evidence_ids: evidence.map((e) => e.evidence_id),
      evidence,
    };
  }

  private categoryFacts(ctx: DiscoveryRunContext, category: string): ReconciledFact[] {
    const fields = CATEGORY_FIELDS[category] ?? [];
    return (ctx.state.facts ?? []).filter(
      (f) => f.validated && (f.category ? f.category === category : fields.includes(f.field)),
    );
  }

  private homepageDescription(pages: PageRow[], registry: SourceLookup, ids: IdAllocator, now: string): ScalarField {
    const home = pages.find((p) => p.pageType === 'HOMEPAGE');
    const description = home ? readPageState(home.pipelineState).description : null;
    if (!home || !description) return null;
    const source = this.pageSource(home);
    const evidence = this.toEvidenceItem(source, 'first_party', registry, ids);
    return {
      fact_id: this.nextFactId(ids, 'description'),
      value: description,
      status: 'supported',
      fact_type: 'explicit',
      confidence: 0.6,
      last_checked_at: now,
      evidence_ids: evidence ? [evidence.evidence_id] : [],
      evidence: evidence ? [evidence] : [],
    };
  }

  /** A selected `case-study` page is the evidence that this proof exists. */
  private caseStudyValues(pages: PageRow[], registry: SourceLookup, ids: IdAllocator, now: string): ArrayField {
    return pages
      .filter((p) => p.fetchStatus === 'FETCHED' && readPageState(p.pipelineState).purposeCategory === 'case-study')
      .map((p) => {
        const evidence = this.toEvidenceItem(this.pageSource(p), 'first_party', registry, ids);
        return {
          fact_id: this.nextFactId(ids, 'case-study'),
          value: readPageState(p.pipelineState).title?.trim() || p.url,
          status: 'supported' as const,
          fact_type: 'explicit' as const,
          confidence: 0.75,
          last_checked_at: now,
          evidence_ids: evidence ? [evidence.evidence_id] : [],
          evidence: evidence ? [evidence] : [],
        };
      });
  }

  /** The site's own declared logo, from JSON-LD already collected at inspect time. */
  private logoValue(pages: PageRow[], registry: SourceLookup, ids: IdAllocator, now: string): ScalarField {
    for (const page of pages) {
      const entities = readPageState(page.pipelineState).jsonLd ?? [];
      for (const entity of entities) {
        const logo = entity.fields['logo'];
        const url = typeof logo === 'string' ? logo : logo && typeof logo === 'object' ? (logo as { url?: unknown }).url : null;
        if (typeof url !== 'string' || !url.trim()) continue;
        const evidence = this.toEvidenceItem(this.pageSource(page), 'first_party', registry, ids);
        return {
          fact_id: this.nextFactId(ids, 'logo'),
          value: url.trim(),
          status: 'supported',
          fact_type: 'explicit',
          confidence: 0.8,
          last_checked_at: now,
          evidence_ids: evidence ? [evidence.evidence_id] : [],
          evidence: evidence ? [evidence] : [],
        };
      }
    }
    return null;
  }

  private digitalPresence(social: SocialRow[], now: string, ids: IdAllocator): CompanyContextProfileJson['digital_presence'] {
    const buckets: CompanyContextProfileJson['digital_presence'] = {
      social_profiles: [],
      app_profiles: [],
      developer_profiles: [],
      content_channels: [],
      community_links: [],
    };

    for (const row of social) {
      const platform = row.platform as PresencePlatform;
      const group = PLATFORM_GROUP[platform];
      // `personal` platforms (Scholar, ORCID) are people, not the company.
      if (group === 'personal') continue;

      const value = this.plainValue(row.url, 'explicit', row.score === null ? 0.6 : Math.min(1, row.score / 100), now, ids);
      if (row.platform === 'github') buckets.developer_profiles.push(value);
      else if (platform === 'app-store' || platform === 'play-store') buckets.app_profiles.push(value);
      else if (group === 'social') buckets.social_profiles.push(value);
      else if (group === 'publishing') buckets.content_channels.push(value);
      else buckets.community_links.push(value);
    }

    return buckets;
  }

  private identityTypeValue(
    identity: { type: string; confidence: number; evidenceFacts: ReconciledFact[] },
    registry: SourceLookup,
    ids: IdAllocator,
    now: string,
  ): ScalarField {
    const evidence = identity.evidenceFacts
      .slice(0, MAX_EVIDENCE_PER_FACT)
      .map((f) => this.toEvidenceItem(f.sources[0], f.sourceType, registry, ids))
      .filter((e): e is EvidenceValue => e !== null);

    return {
      fact_id: this.nextFactId(ids, 'company-type'),
      value: identity.type,
      status: 'supported',
      // An inference over the site's own declared identity, never a verbatim claim.
      fact_type: 'strong_inference',
      confidence: identity.confidence,
      last_checked_at: now,
      evidence_ids: evidence.map((e) => e.evidence_id),
      evidence,
    };
  }

  /**
   * The spec doc's Definition-of-Done gates, reported as run notes so the run's
   * outcome is explained rather than just labelled. The orchestrator uses the
   * same two numbers to decide between `COMPLETE`, `COMPLETE_WITH_GAPS` and
   * `MANUAL_REVIEW_REQUIRED` — they are read off this stage's own output
   * (`identity.company_type.confidence`) and the page rows, so nothing extra has
   * to be threaded through state.
   */
  private async reportDefinitionOfDone(
    ctx: DiscoveryRunContext,
    sections: Omit<CompanyContextProfileJson, 'sources' | 'conflicts' | 'missing_fields' | 'research_metadata'>,
    pagesAnalyzed: number,
    pagesFetched: number,
  ): Promise<void> {
    const identityConfidence = sections.identity.company_type?.confidence ?? 0;
    if (identityConfidence < IDENTITY_CONFIDENCE_FLOOR) {
      await ctx.note(
        `Identity confidence ${identityConfidence.toFixed(2)} is below the ${IDENTITY_CONFIDENCE_FLOOR} floor — ` +
          `the company this profile describes needs a human check before later modules rely on it.`,
      );
    }
    if (pagesFetched > 0 && pagesAnalyzed / pagesFetched < REACHABLE_PAGES_FLOOR) {
      await ctx.note(
        `Only ${pagesAnalyzed}/${pagesFetched} fetched pages were analyzed (below ${Math.round(REACHABLE_PAGES_FLOOR * 100)}%) — ` +
          `the profile is based on a partial view of the site.`,
      );
    }
  }

  // ─── Sources & evidence ─────────────────────────────────────────────────

  /**
   * One registry entry per page we tried, plus one per search source a fact
   * cites. A page that failed to fetch is still registered with
   * `accessible: false` — that the source was tried and could not be read is
   * itself worth recording, and it is what tells a reader why a section is thin.
   */
  private buildSourceRegistry(pages: PageRow[], facts: ReconciledFact[]): SourceLookup {
    const entries: SourceRegistryEntry[] = [];
    const idByUrl = new Map<string, string>();

    const add = (url: string, entry: Omit<SourceRegistryEntry, 'source_id' | 'url'>): void => {
      if (idByUrl.has(url)) return;
      const sourceId = `source-${String(entries.length + 1).padStart(3, '0')}`;
      idByUrl.set(url, sourceId);
      entries.push({ source_id: sourceId, url, ...entry });
    };

    for (const page of pages) {
      const state = readPageState(page.pipelineState);
      add(page.url, {
        title: state.title ?? null,
        source_type: 'first_party',
        page_type: toOutputPageType(page.pageType),
        publisher: null,
        published_at: null,
        fetched_at: state.fetchedAt ?? page.createdAt.toISOString(),
        content_hash: page.contentHash,
        accessible: page.fetchStatus === 'FETCHED',
      });
    }

    for (const fact of facts) {
      for (const source of fact.sources) {
        if (fact.sourceType === 'external') {
          // We never retrieved the document itself — the evidence is the search
          // result's own excerpt — so it is registered as not-accessed rather
          // than implying we read it.
          add(source.url, {
            title: null,
            source_type: 'external',
            page_type: 'external',
            publisher: null,
            published_at: null,
            fetched_at: source.fetchedAt,
            content_hash: null,
            accessible: false,
          });
        }
      }
    }

    return { entries, idByUrl };
  }

  /**
   * `sourceType` is passed in rather than read off the source: in this schema
   * first-party-vs-external is a property of the *fact* (a search result and a
   * crawled page can both support the same value), not of each citation.
   */
  private toEvidenceItem(
    source: FactSource | undefined,
    sourceType: SourceType,
    registry: SourceLookup,
    ids: IdAllocator,
  ): EvidenceValue | null {
    if (!source || !source.url) return null;
    const sourceId = registry.idByUrl.get(source.url);
    if (!sourceId) return null;
    ids.evidenceCount++;
    return {
      evidence_id: `evidence-${String(ids.evidenceCount).padStart(3, '0')}`,
      source_id: sourceId,
      source_url: source.url,
      source_type: sourceType,
      page_type: toOutputPageType(source.pageType),
      quote: (source.excerpt ?? '').slice(0, MAX_QUOTE_CHARS),
      published_at: null,
      fetched_at: source.fetchedAt,
    };
  }

  /** A page row as a citation, for values sourced from the page itself. */
  private pageSource(page: PageRow): FactSource {
    const state = readPageState(page.pipelineState);
    return {
      url: page.url,
      pageType: state.purposeCategory ? (state.purposeCategory as FactSource['pageType']) : null,
      excerpt: null,
      fetchedAt: state.fetchedAt ?? page.createdAt.toISOString(),
      contentHash: page.contentHash,
    };
  }

  private nextFactId(ids: IdAllocator, field: string): string {
    const n = (ids.factCount.get(field) ?? 0) + 1;
    ids.factCount.set(field, n);
    return `fact-${field}-${String(n).padStart(3, '0')}`;
  }

  // ─── Scores ─────────────────────────────────────────────────────────────

  /**
   * Weighted completeness, ported from the old code's `scoreCompleteness`: per
   * category `1 − missingFields / expectedFields`, `digital_presence` binary,
   * combined with the tuned weights. A category with no summary at all counts
   * as fully missing — the same thing the scorer already assumed.
   */
  private scoreCompleteness(
    summaries: { category: string; missingFields: FactField[] }[],
    hasAssertedSocialProfile: boolean,
  ): {
    completeness: Record<string, number>;
    overallCompleteness: number;
  } {
    const completeness: Record<string, number> = {};
    for (const [category, fields] of Object.entries(CATEGORY_FIELDS)) {
      const row = summaries.find((s) => s.category === category);
      const missing = row ? row.missingFields.length : fields.length;
      completeness[category] = fields.length > 0 ? Math.max(0, 1 - missing / fields.length) : 0;
    }

    // Binary by design: either we can point at the company's own account or we
    // cannot. A partial footprint is not "60% present".
    completeness[DIGITAL_PRESENCE_CATEGORY] = hasAssertedSocialProfile ? DIGITAL_PRESENCE_PRESENT : DIGITAL_PRESENCE_ABSENT;

    let overall = 0;
    for (const [category, weight] of Object.entries(CATEGORY_WEIGHTS)) overall += (completeness[category] ?? 0) * weight;
    return { completeness, overallCompleteness: Number(overall.toFixed(3)) };
  }

  /**
   * Mean confidence over the run's validated facts. The old code reported only
   * an identity confidence; the spec schema asks for one overall number, and the
   * mean of what was actually kept is the only one that can be defended from the
   * data at hand. Falls back to the identity confidence when nothing survived.
   */
  private scoreConfidence(facts: ReconciledFact[], companyType: ScalarField): number {
    const identityConfidence = companyType?.confidence ?? 0;
    if (facts.length === 0) return Number(identityConfidence.toFixed(3));
    const mean = facts.reduce((sum, f) => sum + f.confidence, 0) / facts.length;
    return Number(mean.toFixed(3));
  }

  private averageConfidence(facts: ReconciledFact[]): number | null {
    if (facts.length === 0) return null;
    return Number((facts.reduce((sum, f) => sum + f.confidence, 0) / facts.length).toFixed(3));
  }

  // ─── Conflicts & gaps ───────────────────────────────────────────────────

  /** Two facts that cannot both be true, plus consolidate's and verify's own notes. */
  private buildConflicts(facts: ReconciledFact[], summaries: { category: string; conflictNotes: string[] }[]): ProfileConflict[] {
    const conflicts: ProfileConflict[] = [];
    const fields = new Set(facts.map((f) => f.field));
    for (const field of fields) {
      const conflicted = facts.filter((f) => f.field === field && f.factType === 'conflicted');
      if (conflicted.length === 0) continue;
      conflicts.push({
        field,
        values: conflicted.map((f) => f.value),
        note: 'Sources disagree on this value; every candidate is kept rather than one being chosen.',
      });
    }
    for (const summary of summaries) {
      for (const note of summary.conflictNotes) {
        conflicts.push({ field: summary.category, values: [], note });
      }
    }
    return conflicts;
  }

  /** Every expected field with no validated value — the schema's own "not found". */
  private buildMissingFields(summaries: { category: string; missingFields: FactField[] }[]): MissingFieldEntry[] {
    const out: MissingFieldEntry[] = [];
    for (const [category, fields] of Object.entries(CATEGORY_FIELDS)) {
      const row = summaries.find((s) => s.category === category);
      const missing = row ? row.missingFields : fields;
      for (const field of missing) out.push({ field, category, note: null });
    }
    return out;
  }

  // ─── Identity type (ported verbatim) ────────────────────────────────────

  /**
   * Site-context-v2 §2 — a deliberately conservative heuristic, not a
   * classifier: with only one site's own facts to go on (no cross-domain
   * corroboration), this can reliably flag "this domain says it belongs to a
   * different legal entity than the one holding the Cailyx project" and nothing
   * finer. Franchise/regional-site detection needs multi-location evidence this
   * pipeline doesn't gather yet — left `unknown` rather than guessed.
   */
  private resolveIdentity(facts: ReconciledFact[], projectKey: string): {
    type: 'company' | 'subsidiary' | 'unknown';
    confidence: number;
    evidenceFacts: ReconciledFact[];
  } {
    const legalName = facts.find((f) => f.field === 'legalName');
    const orgBrand = facts.find((f) => f.field === 'brand');
    const hasParentOrgSignal = facts.some((f) => f.field === 'legalName' || f.field === 'alternateName');
    const evidenceFacts = [legalName, orgBrand].filter((f): f is ReconciledFact => f !== undefined);

    if (!legalName && !orgBrand) {
      return { type: 'unknown', confidence: 0.2, evidenceFacts: [] };
    }
    const orgKey = (legalName?.value ?? orgBrand?.value ?? '').trim().toLowerCase();
    const shareWord = projectKey.split(/\s+/).some((w) => w.length > 2 && orgKey.includes(w));
    if (!shareWord && hasParentOrgSignal) {
      // The site's own declared identity shares no word with the project's name
      // on record — plausibly a product microsite or subsidiary, but there is no
      // `parentOrganization` fact to tell which, so it is flagged, not guessed
      // further.
      return { type: 'subsidiary', confidence: 0.5, evidenceFacts };
    }
    return { type: 'company', confidence: legalName ? 0.8 : 0.6, evidenceFacts };
  }
}

// ─── Local row shapes ─────────────────────────────────────────────────────
//
// Structural subsets of the Prisma rows this stage reads, so the compilers of
// the value builders above stay readable. They are assignable from the real
// generated row types.

interface PageRow {
  id: string;
  url: string;
  pageType: string;
  fetchStatus: string;
  contentHash: string | null;
  pipelineState: unknown;
  createdAt: Date;
}

interface SocialRow {
  platform: string;
  url: string;
  score: number | null;
  verificationStatus: string;
}

type EvidenceValue = FactValue['evidence'][number];

/**
 * The spec doc's `page_type` values are snake_case (`case_study`, `blog_post`),
 * while the pipeline's internal vocabulary is kebab-case (`case-study`). Profile
 * output always uses the doc's spelling so a consumer matching on its taxonomy
 * does not have to know ours; a source with no classified page (a search result,
 * or a page that failed classification) reads as `external`.
 */
function toOutputPageType(type: string | null | undefined): string {
  if (!type) return 'external';
  return type.toLowerCase().replace(/-/g, '_');
}
