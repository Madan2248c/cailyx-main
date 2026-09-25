/**
 * Stage 4 — Extract.
 *
 * Two passes, exactly as the shipped code ran them:
 *
 * 1. **Deterministic, always runs** — JSON-LD entities become identity/
 *    geography/organization facts, and heading/hero copy becomes candidate
 *    services/valueProps. No model, no cost, idempotent.
 * 2. **LLM batched pass** — 4 pages per call, each page's text sliced to
 *    `MAX_BATCH_CHARS`, the whole pass gated by the run's character budget.
 *
 * Ported from the old repo's `AeoContextService.stageExtract` (+ its
 * `extractJsonLdFacts`, `extractPageFactsDeterministic`, `extractBatchLlm`,
 * `validateBatchFacts`), logic and prompt text verbatim. What changed is only
 * where the work is persisted — see below.
 *
 * ## Where facts live now
 *
 * The old code wrote one `SiteContextFact` row per fact. This module has no
 * facts table (deliberately — see docs/analysis/discovery.md "Why only 4
 * tables"), so each fact is appended to **the page it came from**:
 * `discovered_pages.pipeline_state.facts`. That placement is what makes the
 * stage resumable: a job that pauses mid-extraction leaves every page already
 * paid for marked `done`, and the continuation job re-reads them rather than
 * re-spending the LLM call. The reconcile stage aggregates these back up.
 *
 * ## Two deliberate deviations from the old stage
 *
 * - **Candidates arrive pre-filtered, not as raw HTML.** The old deterministic
 *   pass read the page DOM itself: heading levels, `class*="card"` /
 *   `class*="hero"` selectors, and a `closest()` ancestor walk so a team grid's
 *   names were not read as services. This module stores no raw HTML by design
 *   (docs/analysis/discovery.md "What we persist per page"), so those signals
 *   are captured by the inspect stage while it still has the DOM — see
 *   `extractServiceCandidates`/`extractValuePropCandidates` in pipeline-utils —
 *   and this stage applies only the page-type gate, which is where that gate
 *   lived in the old code too. No filter or selector was dropped.
 * - **`extractStatus` values.** The old stage used `pending | success |
 *   failed | skipped`. The persisted shape declared by `PagePipelineState` is
 *   `pending | done | failed`, so a page that exhausted its retries is stored
 *   as `failed` with `retryCount` past the cap — an equivalent state, since
 *   that count is what gates a retry.
 */

import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client.js';
import { PrismaService } from '../../../../prisma/prisma.service.js';
import { EXTRACT_BATCH_SIZE, EXTRACTION_FIELDS, MAX_BATCH_CHARS } from '../../discovery.constants.js';
import type { DraftFact, FactField, FactType, JsonLdEntity, PagePipelineState, PageType } from '../../discovery.types.js';
import { PRISMA_TO_PAGE_TYPE, readPageState } from '../../discovery.types.js';
import { normalizeHeading } from '../pipeline-utils.js';
import { RunPausedException, type DiscoveryRunContext } from '../pipeline-context.js';
import { LlmService } from '../llm.service.js';

/**
 * JSON-LD entity types whose `name` field is the company's or brand's own name.
 * See the comment at the `brand` push in `extractJsonLdFacts` for why this is an
 * allow-list rather than "anything that is not a Person or a Place".
 */
const BRAND_NAME_ENTITY_TYPES = new Set([
  'Organization',
  'Corporation',
  'LocalBusiness',
  'ProfessionalService',
  'Brand',
  'WebSite',
  'SoftwareApplication',
]);

/** Pages whose content is about the company itself — never a source of customer-facing facts. */
const ORG_ONLY_PAGE_TYPES = new Set<PageType>(['careers', 'press', 'partner', 'leadership']);

/** Page types where a heading is actually likely to name a paid offering. */
const SERVICE_HEADING_PAGE_TYPES = new Set<PageType>(['homepage', 'service', 'pricing', 'industries', 'case-study']);

/** Page types where an H1/hero line is actually likely to be a marketing tagline. */
const VALUE_PROP_HEADING_PAGE_TYPES = new Set<PageType>(['homepage', 'service', 'pricing']);

/** Cap on facts kept per page — the old code capped each pass, this caps the page's total. */
const MAX_FACTS_PER_PAGE = 60;

/** A row this stage reads: the page plus the pipeline state it writes back to. */
interface ExtractPage {
  id: string;
  url: string;
  pageType: PageType;
  cleanedText: string | null;
  jsonLdRaw: string | null;
  contentHash: string | null;
  state: PagePipelineState;
}

@Injectable()
export class ExtractStage {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  async run(ctx: DiscoveryRunContext): Promise<void> {
    const rows = await this.prisma.discoveredPage.findMany({
      where: { discoveryRunId: ctx.runId, fetchStatus: 'FETCHED' },
      orderBy: { url: 'asc' },
    });

    // Only pages the select stage actually reserved a coverage slot for.
    const selected: ExtractPage[] = rows
      .map((row) => ({
        id: row.id,
        url: row.url,
        pageType: PRISMA_TO_PAGE_TYPE[row.pageType],
        cleanedText: row.cleanedText,
        jsonLdRaw: row.jsonLdRaw,
        contentHash: row.contentHash,
        state: readPageState(row.pipelineState),
      }))
      .filter((page) => page.state.selected === true);

    // ─── Pass 1: deterministic (always attempted, idempotent, never "fails") ──
    for (const page of selected) {
      if ((page.state.extractStatus ?? 'pending') !== 'pending') continue;
      const facts = [...this.extractPageFactsDeterministic(page), ...this.extractJsonLdFacts(page)];
      if (facts.length === 0) continue;
      this.appendFacts(page, facts);
      await this.savePage(page);
    }

    // Without a provider there is no second pass — every page still marked
    // pending is done as far as this stage can take it.
    if (!this.llm.isAvailable()) {
      for (const page of selected) {
        if ((page.state.extractStatus ?? 'pending') !== 'pending') continue;
        page.state.extractStatus = 'done';
        await this.savePage(page);
      }
      return;
    }

    // ─── Pass 2: LLM batched ────────────────────────────────────────────────
    const maxRetries = ctx.budget.limits.maxRetriesPerPage;
    const retryable = selected.filter((page) => {
      const status = page.state.extractStatus ?? 'pending';
      if (status === 'done') return false;
      // A page past the retry cap is not retried again — the old code stored
      // this as a distinct `skipped` status; here the count carries it.
      return (page.state.retryCount ?? 0) <= maxRetries;
    });

    let cursor = 0;
    while (cursor < retryable.length) {
      if (ctx.budget.charsLeft() <= 0) {
        await ctx.note(
          `Extraction stopped at the character budget (${ctx.budget.limits.maxChars}) — ${retryable.length - cursor} selected page(s) still pending.`,
        );
        break;
      }
      // Out of time, not out of budget: the remaining pages still need the LLM
      // pass, so this is a *pause*, not a completion. Throwing (rather than
      // breaking) stops the orchestrator from checkpointing this stage as
      // finished — otherwise the continuation would resume at RECONCILE and the
      // pending pages would never be extracted at all. The continuation re-runs
      // this stage, which skips the pages already `done` and picks up from here.
      // Found in a live run: two of six selected pages were extracted and the
      // other four were silently skipped.
      if (ctx.budget.deadlineReached()) throw new RunPausedException('EXTRACT');

      const batch: ExtractPage[] = [];
      let batchChars = 0;
      while (cursor < retryable.length && batch.length < EXTRACT_BATCH_SIZE) {
        const page = retryable[cursor]!;
        const text = (page.cleanedText || '').slice(0, MAX_BATCH_CHARS);
        if (batch.length > 0 && batchChars + text.length > MAX_BATCH_CHARS) break;
        batch.push(page);
        batchChars += text.length;
        cursor++;
      }
      if (batch.length === 0) break;

      try {
        const { facts, model, costUsd } = await this.extractBatchLlm(batch);
        ctx.budget.spendChars(batchChars);
        this.distributeFacts(facts, batch);
        for (const page of batch) {
          page.state.extractStatus = 'done';
          page.state.extractError = null;
          await this.savePage(page);
        }
        await ctx.note(`__cost__:${costUsd}:${model}`);
      } catch (err) {
        const message = (err as Error).message.slice(0, 300);
        for (const page of batch) {
          const nextRetry = (page.state.retryCount ?? 0) + 1;
          page.state.extractStatus = 'failed';
          page.state.extractError = message;
          page.state.retryCount = nextRetry;
          await this.savePage(page);
        }
        ctx.logger.warn(`Context extract batch failed (${batch.map((p) => p.url).join(', ')}): ${message}`);
      }
    }
  }

  // ─── Deterministic pass ───────────────────────────────────────────────────

  /**
   * JSON-LD entities -> identity/geography/organization facts (§9's "structured
   * data is evidence, not guaranteed truth" — these are marked `explicit`
   * because the site's own markup states them, but still go through
   * validation like every other fact).
   */
  private extractJsonLdFacts(page: ExtractPage): DraftFact[] {
    const entities: JsonLdEntity[] = page.state.jsonLd ?? [];
    if (entities.length === 0) return [];
    const out: DraftFact[] = [];
    // `excerpt` here is text that appears LITERALLY in the page's raw JSON-LD
    // block, not a paraphrase — so the validate stage's verbatim check works
    // the same way it does for a text-extracted fact. It is deliberately NOT
    // `JSON.stringify(raw)`, which would never match because of
    // quoting/escaping differences.
    const push = (field: FactField, value: string, excerptText: string): void => {
      const trimmed = value.trim();
      const excerpt = excerptText.trim();
      if (!trimmed || trimmed.length > 300 || !excerpt) return;
      out.push({
        field,
        value: trimmed,
        sourceUrl: page.url,
        contentHash: page.contentHash,
        factType: 'explicit',
        excerpt: excerpt.slice(0, 280),
      });
    };
    const asStrings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : [];

    for (const entity of entities) {
      const f = entity.fields;
      if (typeof f.legalName === 'string') push('legalName', f.legalName, f.legalName);
      for (const alt of asStrings(f.alternateName)) push('alternateName', alt, alt);
      // Only entities that can denote the company itself may name the brand.
      // The old code's rule was "not a Person, not a Place", which let a
      // `Product` block name the brand: a live run found resend.com's product
      // page contributing "Resend marketing emails" as a brand alongside
      // "Resend", which made `brand` a singular-field conflict, marked the
      // profile's business_name `conflicted`, and dragged its confidence down.
      // `WebSite` and `SoftwareApplication` stay in the set — a site that
      // publishes only WebSite schema, or a SaaS whose app name is its brand,
      // both still resolve correctly.
      if (typeof f.name === 'string' && BRAND_NAME_ENTITY_TYPES.has(entity.type)) push('brand', f.name, f.name);
      if (typeof f.foundingDate === 'string') {
        const year = f.foundingDate.match(/\d{4}/)?.[0];
        if (year) push('foundedYear', year, f.foundingDate);
      }
      if (f.address) {
        const addr = f.address as Record<string, unknown> | string;
        if (typeof addr === 'string') {
          push('headquarters', addr, addr);
        } else {
          const parts = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(
            (x): x is string => typeof x === 'string',
          );
          const formatted = parts.join(', ');
          // Validate against one literal part (e.g. the city), not the joined
          // string — the join is our own formatting and would never appear
          // verbatim in the source markup.
          if (formatted && parts[0]) push('headquarters', formatted, parts[0]);
        }
      }
      if (typeof f.telephone === 'string') push('contact', f.telephone, f.telephone);
      if (typeof f.email === 'string') push('contact', f.email, f.email);
      for (const award of asStrings(f.award)) push('award', award, award);
      if (f.founder) {
        const founders = Array.isArray(f.founder) ? f.founder : [f.founder];
        for (const founder of founders) {
          const name = typeof founder === 'string' ? founder : (founder as Record<string, unknown> | undefined)?.name;
          if (typeof name === 'string') push('leadership', name + ' (founder)', name);
        }
      }
    }
    return out.slice(0, 20);
  }

  /**
   * Heading/hero candidates on one page -> service and value-prop facts, each
   * cited to that page.
   *
   * The candidates arrive pre-filtered from the inspect stage, which is the only
   * place the DOM existed: heading *level*, card/tile structure and the
   * team/testimonial ancestor check are all invisible in the cleaned text this
   * module stores instead of raw HTML. What is left for this method is the
   * page-type gate — unchanged from the old code, which is where it lived there
   * too.
   */
  private extractPageFactsDeterministic(page: ExtractPage): DraftFact[] {
    const serviceCandidates = page.state.serviceCandidates ?? [];
    const valuePropCandidates = page.state.valuePropCandidates ?? [];
    if (serviceCandidates.length === 0 && valuePropCandidates.length === 0) return [];

    const out: DraftFact[] = [];
    const seen = new Set<string>();

    // The old code capped a page's deterministic facts at 40 across both fields.
    const add = (field: FactField, text: string): void => {
      const key = field + ':' + text.toLowerCase();
      if (seen.has(key) || out.length >= 40) return;
      seen.add(key);
      out.push({ field, value: text, sourceUrl: page.url, excerpt: text, contentHash: page.contentHash });
    };

    if (SERVICE_HEADING_PAGE_TYPES.has(page.pageType)) {
      for (const raw of serviceCandidates) add('services', normalizeHeading(raw));
    }
    if (VALUE_PROP_HEADING_PAGE_TYPES.has(page.pageType)) {
      for (const raw of valuePropCandidates) add('valueProps', normalizeHeading(raw));
    }

    return out;
  }

  // ─── LLM pass ─────────────────────────────────────────────────────────────

  /** One constrained-JSON call per small page batch, each returned fact tagged with its source page. */
  private async extractBatchLlm(batch: ExtractPage[]): Promise<{ facts: DraftFact[]; model: string; costUsd: number }> {
    const urls = batch.map((p) => p.url);
    let corpus = '';
    for (const page of batch) {
      const tag = ORG_ONLY_PAGE_TYPES.has(page.pageType)
        ? ` [page type: ${page.pageType} — internal/organizational page, NOT a source for services/valueProps/businessModel/category/description]`
        : '';
      corpus +=
        '\n\n--- ' +
        page.url +
        tag +
        ' ---\n' +
        (page.state.title ? page.state.title + '\n' : '') +
        (page.cleanedText || '').replace(/\s+/g, ' ').trim().slice(0, MAX_BATCH_CHARS);
    }

    const result = await this.llm.json(
      {
        purpose: 'site context extraction (batch)',
        maxTokens: 1800,
        system:
          'You read company web pages and extract factual assertions about the company itself — never about its ' +
          'customers, partners or people it merely mentions. Rules:\n' +
          '- Use ONLY what the page text states. Never complete a missing detail from general/outside knowledge.\n' +
          '- Every fact MUST cite the exact page URL it came from (sourcePage, must be one of the URLs given) and a short verbatim excerpt (<=200 chars, copied text, not a paraphrase) that supports it.\n' +
          '- factType is one of: "explicit" (directly stated), "strong_inference" (clearly implied by multiple ' +
          'signals on the page but not stated outright), "weak_inference" (plausible but thin support — prefer ' +
          'omitting the fact instead of using this).\n' +
          '- Before writing a fact, check the sentence for negation ("we do NOT offer X", "unlike other providers ' +
          'we don\'t...") — never emit a fact whose sentence is negated.\n' +
          '- A page marked "[page type: ... — internal/organizational page, ...]" is about the company\'s own hiring, ' +
          'investors or partners — e.g. a careers page\'s "paid internship" or "join our team" copy is written for ' +
          'job applicants, not customers. Never extract services/valueProps/businessModel/category/description from ' +
          'such a page; it may still supply organizational facts (legalName, headquarters, foundedYear, leadership, contact).\n' +
          '- field is one of: services, icp, valueProps, painPoints, outcomes, markets, category, vertical, ' +
          'description, legalName, alternateName, foundedYear, headquarters, officeLocation, languages, ' +
          'pricingModel, differentiator, leadership, certification, award, partner, technology, businessModel, contact.\n' +
          '- services: concrete offerings a buyer can pay for, 2-6 words, in the site\'s own words. Exclude pricing tiers, process steps, company values, people\'s names, and a storefront\'s own catalog/browse chrome ("Shop by Category", "Trending Brands", "New Arrivals", "Best Sellers") — those organize an existing catalog, they are not themselves a thing sold. ' +
          'Also exclude, even when they appear as headings, every marketing phrase that is not a thing sold: calls to action ("Integrate tonight", "Start free"), benefit and quality claims ("First-class developer experience", "Battle-tested infrastructure", "Beyond expectations"), slogans and rallying lines ("Reach humans, not spam folders", "Do more with your time"), and page section titles ("Everything in your control", "Full visibility"). ' +
          'A section heading is a service only if you could put it on an invoice. Test each candidate: could a buyer purchase this as a named thing? If it describes how good the product is, or tells the reader to do something, it is not a service — omit it.\n' +
          '- valueProps: a claim about what the product does for the buyer, in the site\'s own words. Only the COMPANY\'s own claim — a testimonial, case-study quote, analyst line or partner\'s copy is a third party speaking, so never extract one as a valueProp or differentiator.\n' +
          '- icp: who buys — role, company type, or segment.\n' +
          '- markets: geographic markets the company SERVES, as ISO-3166 alpha-2 country codes.\n' +
          '- painPoints: a problem the BUYER has before working with this company — not a problem the company itself faces.\n' +
          '- outcomes: a result the company promises the buyer, stated as an outcome, not a feature list restated.\n' +
          '- category: a short (2-5 word) descriptor of what kind of business this is (e.g. "b2b logistics software").\n' +
          '- vertical: the industry the company sells INTO, if the page names one (e.g. "healthcare", "construction").\n' +
          '- pricingModel: how the company charges (e.g. "subscription", "per-project quote", "usage-based") — only if the page actually states or clearly shows a pricing structure.\n' +
          '- differentiator: a stated reason to choose this company over alternatives — must be comparative or exclusivity language, not a plain feature, and must be the company saying it about itself.\n' +
          '- leadership: a named person with their role, only when the page states BOTH and presents them as this company\'s own founder, executive or team member. Never extract an investor, advisor, customer, or a partner/other company\'s executive who merely appears on the page (a quote from "X, CEO at Y" is Y\'s leadership, not this company\'s).\n' +
          '- businessModel: how the company sells (e.g. "self-serve SaaS", "field service with local technicians", "B2B agency retainer").\n' +
          '- Return [] for a page/field with no support. An empty result is correct — do not force a value.\n' +
          'Respond with ONLY JSON: {"facts":[{"field":string,"value":string,"sourcePage":string,"excerpt":string,"factType":string}]}',
        user: 'Pages (' + urls.join(', ') + ') follow.\n' + corpus,
      },
      (raw) => this.validateBatchFacts(raw, urls),
    );

    const facts: DraftFact[] = result.data.map((f) => ({
      field: f.field,
      value: f.value,
      sourceUrl: f.sourcePage,
      excerpt: f.excerpt,
      factType: f.factType,
      contentHash: batch.find((p) => p.url === f.sourcePage)?.contentHash ?? null,
    }));
    return { facts, model: result.model, costUsd: result.costUsd };
  }

  /** The trust boundary: anything the model returns outside the declared shape is dropped, never coerced. */
  private validateBatchFacts(
    raw: unknown,
    allowedUrls: string[],
  ): Array<{ field: FactField; value: string; sourcePage: string; excerpt: string; factType: FactType }> {
    const obj = (raw ?? {}) as { facts?: unknown };
    if (!Array.isArray(obj.facts)) return [];
    const validFields = new Set<FactField>(EXTRACTION_FIELDS);
    const validFactTypes: FactType[] = ['explicit', 'strong_inference', 'weak_inference'];
    const urlSet = new Set(allowedUrls);
    const out: Array<{ field: FactField; value: string; sourcePage: string; excerpt: string; factType: FactType }> = [];
    for (const entry of obj.facts) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const field = typeof e.field === 'string' ? e.field : '';
      const value = typeof e.value === 'string' ? e.value.trim() : '';
      const sourcePage = typeof e.sourcePage === 'string' ? e.sourcePage.trim() : '';
      const excerpt = typeof e.excerpt === 'string' ? e.excerpt.trim() : '';
      const factTypeRaw = typeof e.factType === 'string' ? e.factType : 'weak_inference';
      const factType = validFactTypes.includes(factTypeRaw as FactType) ? (factTypeRaw as FactType) : 'weak_inference';
      if (!validFields.has(field as FactField)) continue;
      if (value.length === 0 || value.length > 300) continue;
      if (!urlSet.has(sourcePage)) continue; // hallucinated source page — dropped, never trusted
      if (excerpt.length === 0) continue;
      if (field === 'markets' && !/^[A-Za-z]{2}$/.test(value)) continue;
      out.push({
        field: field as FactField,
        value: field === 'markets' ? value.toUpperCase() : value,
        sourcePage,
        excerpt: excerpt.slice(0, 300),
        factType,
      });
    }
    return out.slice(0, 60);
  }

  /** Attach LLM facts to their own cited page, keeping facts already on that page. */
  private distributeFacts(facts: DraftFact[], batch: ExtractPage[]): void {
    const byUrl = new Map(batch.map((page) => [page.url, page]));
    for (const fact of facts) {
      const page = byUrl.get(fact.sourceUrl);
      if (page) this.appendFacts(page, [fact]);
    }
  }

  private appendFacts(page: ExtractPage, facts: DraftFact[]): void {
    const merged = [...(page.state.facts ?? []), ...facts];
    page.state.facts = merged.length > MAX_FACTS_PER_PAGE ? merged.slice(0, MAX_FACTS_PER_PAGE) : merged;
  }

  private async savePage(page: ExtractPage): Promise<void> {
    await this.prisma.discoveredPage.update({
      where: { id: page.id },
      data: { pipelineState: page.state as Prisma.InputJsonValue },
    });
  }
}
