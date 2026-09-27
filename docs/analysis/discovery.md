# Discovery / Company-Context Module — Analysis

Status: **built** (DB, backend, tests). See "As built — where this design
changed" at the end for the four places the implementation departs from what
is written below, and why.

## As built — where this design changed

The design below was followed, with four deliberate changes. Everything else —
the tuned constants, the stage order, the confidence formula, the point table,
the 4-table schema — is as specified.

1. **Two `pipeline_state` jsonb columns were added** (`discovery_runs`,
   `discovered_pages`). The schema above has nowhere to persist in-flight
   pipeline state, but the resume design needs it: a job that pauses on the
   elapsed budget and re-enqueues must not re-spend the LLM calls the previous
   job already paid for. Per-page state (inspect metadata, per-page extracted
   facts, extract status) lives on the page row; run-level state (reconciled
   facts, category summaries, coverage plan, search spend) lives on the run.
   Still 4 tables — this is the "do not re-expand" rule honoured, not broken.
2. **`COMPILE` was added to the `DiscoveryStage` enum.** The design lists twelve
   stages and the enum had eleven; without `COMPILE` a finished run could not
   record which stage it finished on.
3. **Page classification moved from inspect to discover.** The classifier is a
   pure URL-regex function (the doc's own rule), so it needs no page content;
   running it as each URL is queued means `discovered_pages.page_type` is never
   null and there is one place for the pattern order to live. Inspect keeps
   metadata extraction.
4. **Inspect reads the DOM at fetch time, inside the discover stage.** The doc
   says inspect works "from already-fetched HTML, no re-fetch" — true when the
   old schema stored raw HTML per page. This module deliberately does not store
   raw HTML, so the only moment the HTML exists is inside the fetch that
   produced it. `readPageSignals()` (owned by the inspect stage) is therefore
   called by discover at insert time, which honours the rule's intent (never pay
   for the same page twice) rather than its letter.

One consequence worth recording: the deterministic extraction pass originally
read heading *levels* and card/hero selectors straight off the DOM, including an
ancestor check that kept a team-member's name from being read as a service.
Those signals are captured at fetch time into the page's pipeline state for
exactly this reason — see `PageSignals` in the inspect stage.

Four further changes were made after the port and after the first live
end-to-end run. All four are corrections to the *ported code* rather than to
this design; the second pair was found by running the real pipeline against a
real site, which is what that run is for.

5. **Consolidate's no-LLM fallback no longer reports every field missing.**
   With an LLM configured but unreachable, the port already answered "are the
   fields absent?"; with no LLM configured at all it answered "did we get to
   summarise?", which reported every category as empty and scored 0
   completeness after a successful extraction. Both paths now use the first
   question. This matters beyond tidiness: `missingFields` drives the
   completeness score, which drives the Definition-of-Done gate.
6. **A defect in the social scoring's own-domain guard was fixed**: the bio
   domain scanner read a capture group that does not exist (the regex's TLD
   group is non-capturing), so a profile naming the client's *own* domain in its
   bio took the −40 penalty meant for other companies' domains. Found by this
   module's test suite; the failing case is now a regression test.

7. **The extract stage signals a *pause* — not completion — when the elapsed
   budget runs out mid-extraction.** It used to stop its batch loop silently,
   which the orchestrator then checkpointed as "EXTRACT completed"; the
   continuation job resumed at the next stage, so pages still awaiting the LLM
   pass were never extracted. The first live run extracted two of its six
   selected pages this way. The stage now raises the pause signal, which by
   design leaves the stage uncheckpointed, so the continuation re-enters it and
   picks up exactly the pending pages. The character-budget stop is unchanged:
   that is a hard cap on what the run will ever extract, not a pause.
8. **The brand name is only taken from JSON-LD entities that can denote the
   company.** The old rule was "any entity that is not a Person or a Place",
   which let a `Product` block name the brand: the live run found resend.com's
   product page contributing "Resend marketing emails" as a brand alongside
   "Resend". Because `brand` is a singular field, that disagreement marked the
   profile's business name `conflicted` and pulled its confidence down — a false
   alarm on a very ordinary site pattern. `WebSite` and `SoftwareApplication`
   remain in the allow-list so a site publishing only WebSite schema, or a SaaS
   whose app name is its brand, still resolves.

The walled-platform list is another place the two sources disagreed, resolved in
favour of the code: `WALLED_HOSTS` includes Crunchbase, G2 and Glassdoor, while
the "Social profile verification" section above names Crunchbase and G2 as
examples of platforms that *can* be fetched. They cannot — all three block
logged-out automation — so the code is right and the examples above are stale.

9. **Consolidation gained a value-judgement pass**, run per category alongside
   the summary call, because the summary call alone could not clean up the
   value list. Asked to *edit* a list ("return the cleaned values"), the small
   model this pipeline runs on returned every value completely unchanged,
   marketing copy included — the offerings example on resend.com is `Integrate
   tonight`, `Write using a delightful editor`, `Beyond expectations` sitting
   right alongside real capabilities, with nothing dropped. Asked instead to
   judge one value at a time — keep or drop, with a reason for "drop" drawn
   from a list of concrete patterns (call to action, benefit claim, slogan,
   section heading, price line, third-party voice, support/community/academy
   channel in an offerings field, feature microcopy and content-free slogans
   in value-claim fields) — the same model correctly
   dropped 14 of 28 values on a first pass, and continued to perform well once
   wired into the real stage. Variants of one capability are merged
   aggressively (keep the fullest wording, mark the rest duplicates) rather
   than carried as separate values. Summaries are written as the company
   itself — never commentary on the evidence. This is the mechanism behind
   {@link CANONICAL_VALUE_FIELDS}/{@link CategorySummary.facts}: `compile`
   only assembles a canonical-value field from what the judge kept (or,
   absent a judgement, from the extracted values deduplicated by exact match)
   — never from the raw extracted list.
10. **The judgement pass chunks by category rather than sending everything in
    one call, and never truncates.** The first version capped each category's
    value list at `VALUE_JUDGEMENT_CAP` (40) before judging, silently keeping
    everything past the cut unjudged — on resend.com's 76 unique `services`
    values, that meant the back half of the list (headings, CTAs, price lines)
    passed straight into the profile regardless of what it actually was. Fixed
    by chunking: a category with more values than one call can hold is judged
    in several calls, and every value is judged. Caught by running the pipeline
    against real extracted facts, not by a unit test — the fixtures never had
    enough distinct values to hit the cap.

Two further observations from the live run are **limitations, not defects**, and
are recorded here so a later module does not mistake them for bugs: profiles are
deduped by URL, so one account reachable under two URL forms (`X` and `twitter`,
a YouTube channel id and its `@handle`) is stored twice; and a deep link to a
platform page (a GitHub *repository* linked from the site) is classified as an
account and can score well, because the point table cannot tell a company's
profile from a company's repository. Both are consequences of the URL-level
classification this design deliberately reuses.

## Scope

Given a `Project` (name + domain, already exists), crawl its website and
produce an evidence-backed company-context profile: identity, offerings,
positioning, ICP, geography, credibility, organization, digital presence,
technology signals — plus classified pages and verified social profiles.
This module ends at "we have a synthesized, stored profile." It does not
build AEO prompts, competitor analysis, keyword research, brand voice, or
report assembly — those are separate future modules that will *read* this
module's output.

Explicitly out of scope (confirmed with user): anything requiring GSC/GA4
(client hasn't onboarded that access at Day-1 time) — that's the later
Technical Audit module. Confirmed by re-reading the full 23-step spec
end-to-end: nothing in the spec itself depends on Search Console, GA4, or
any Google-account-scoped data. PageSpeed Insights is likewise excluded —
it isn't part of the spec at all, and it's a technical/performance
concern that pairs naturally with the Technical Audit module, not company
context.

## Two sources of truth, and how they reconcile

Two references exist for this module:

1. **The Claude Docs spec** ("Website-to-Company Context Enrichment
   Workflow") — the authoritative *intent*: 23 steps, an evidence-bearing
   field format, a "Final Enriched Company-Context Schema," a social-proof
   verification scoring table, and category confidence weights.
2. **The old repo's `aeo-audit/aeo-context.service.ts`** (2,332 lines) — a
   shipped, working implementation of essentially the same pipeline,
   already tuned against real sites.

Where they agree, that's confirmation. Where they disagree, the rule
applied throughout this doc: **prefer the shipped code's tuned numbers,
adopt the spec doc's schema/structure**. Specifically:

- **profile_json's top-level shape** (identity/descriptions/offerings/
  positioning/customers/geography/go_to_market/credibility/organization/
  digital_presence/technology/sources/conflicts/missing_fields/
  research_metadata) — from the spec doc. The shipped code's
  `CATEGORY_FIELDS` map uses the *same 10 category names* (a coincidence
  worth relying on, not a coincidence to second-guess) for everything
  except `digital_presence`, which the code computes separately. This
  lets us keep the code's category-consolidation logic verbatim while
  still producing the doc's schema.
- **Category completeness weights** — the shipped code's tuned weights,
  not the doc's:
  ```
  identity 0.15, descriptions 0.05, offerings 0.15, positioning 0.10,
  customers 0.15, geography 0.10, organization 0.05, credibility 0.10,
  go_to_market 0.05, technology 0.05, digital_presence 0.05  (sums to 1.00)
  ```
  This differs from the doc's proposed weights (digital_presence 10% not
  5%, no separate "descriptions" category) — the doc's numbers were a
  proposal; the code's were tuned against real runs. Per-category
  completeness = `1 − missingFields.length / totalExpectedFieldsForCategory`.
- **Evidence-bearing field format** — the spec doc's richer shape (it
  carries `source_id`, which backs a top-level `sources[]` registry the
  doc also specifies; the code's version doesn't have this because it
  doesn't need a standalone JSON schema contract). Every material field in
  `profile_json` uses:
  ```json
  {
    "fact_id": "fact-icp-001",
    "value": "B2B SaaS companies with 50–500 employees",
    "status": "supported",
    "fact_type": "explicit | strong_inference | weak_inference | conflicted",
    "confidence": 0.82,
    "last_checked_at": "ISO-8601",
    "evidence_ids": ["evidence-001"],
    "evidence": [{
      "evidence_id": "evidence-001",
      "source_id": "source-014",
      "source_url": "https://example.com/customers",
      "source_type": "first_party | external",
      "page_type": "customer",
      "quote": "...",
      "published_at": null,
      "fetched_at": "..."
    }]
  }
  ```
- **Page classification taxonomy** — the shipped code's smaller,
  proven set, not the doc's 29-class list. The doc's list is thorough but
  unimplemented; the code's set (`homepage, service, pricing, about,
  industries, location, case-study, leadership, security, press, careers,
  partner, blog, other`, plus `cart, login, policy` as always-excluded
  purposes) already backs a tuned coverage-target map. Rather than build
  and tune a 29-way classifier from scratch, we adopt the code's set and
  fold the doc's extra classes into the closest existing one (e.g.
  `product`/`solution`/`use_case` → `service`; `testimonial`/`customer` →
  `case-study`; `documentation`/`resource`/`integration`/`compliance` →
  `other`; `investor_relations` → `press`). If a later module needs finer
  granularity, this is a cheap enum extension, not a redesign.
- **Page selection: coverage-based, not score-and-take-top-N.** The doc
  proposes a per-page-type point score (homepage +100 ... generic blog
  +10 ... duplicate −50) and implies ranking by score. The shipped code
  instead fills **per-category target counts in a fixed priority order**
  (`CATEGORY_TARGETS`: homepage:1, service:4, pricing:1, about:1,
  industries:2, location:1, case-study:2, leadership:1, security:1,
  press:1, careers:1, partner:1, other:1; `CATEGORY_PRIORITY` order:
  homepage, service, pricing, about, industries, location, case-study,
  leadership, security, partner, press, careers, other), ranked within a
  category by shallower-then-shorter URL. This is what stops eleven
  similar blog posts from crowding out the one pricing page — a pure
  score-and-sort can't guarantee category diversity the way a per-category
  cap can. We adopt the coverage-based approach; the doc's underlying
  *intent* (commercial/identity pages first, proof pages second,
  supporting content last) is preserved by the priority order.
- **Social profile verification: this is the one place the two sources
  don't reconcile at all**, and needs its own decision (below).

## Social profile verification — reconciled design

The spec doc specifies a 0–100 point scoring table with four status bands
(Verified 80–100, Probable 60–79, Possible 40–59, Rejected <40) — this is
what `social_profiles.verification_status` (from the original briefing)
is meant to hold. The shipped code's `PresenceDiscoveryService` — the
actual same-site crawl-and-verify implementation, no external search
spend — instead produces a 4-value discrete enum (`confirmed / unverified
/ missing / candidate`) with a free-text reason, no numeric score at all.
(`aeo-context.service.ts`'s own social-discovery stage calls a different,
higher-level `PresenceService.discover()` that appears to layer in
DataForSEO search for platforms with no first-party account — not
reused here, since this module has no confirmed external-search budget
yet; see "External enrichment" below.)

**Decision**: reuse `PresenceDiscoveryService.crawl()`'s discovery
mechanics as-is (homepage + `/contact`, `/contact-us`, `/about`,
`/about-us`; JSON-LD `sameAs` walk depth-bounded at 6, correctly
attributing a `Person`-block's `sameAs` to the person not the company;
platform-signature link scan for plain `<a href>`s; dedup preferring the
`sameAs` source) as the *first* pass, then — per the user's decision — run
a SERP-based fallback for platforms still missing afterward (moved from
"deferred" to in-scope; see "SERP fallback" below), then apply our **own
scoring pass** on top of whatever candidates either method found,
implementing the spec doc's point table against the signals that a fetch
can actually produce:

| Signal | Points | Available from same-site crawl? |
|---|---|---|
| Official website links to profile | +45 | Yes — this is what discovery finds |
| Profile links back to exact company domain | +40 | Only for non-walled platforms we can fetch |
| Exact company/brand name match (profile title/bio vs. project identity) | +20 | Only for non-walled platforms |
| Matching logo/branding | +15 | Skipped for v1 (no image comparison) |
| Matching location | +10 | Only if fetched |
| Active/business-oriented profile | +5 | Only if fetched |
| Generic/ambiguous name | −15 | Only if fetched |
| Different company domain in profile bio | −40 | Only if fetched |

Platforms on the walled list (`instagram, facebook, linkedin, x, tiktok,
threads`) are never fetched (same as the old code — they block logged-out
requests), so they can only ever earn the "official site links to it"
signal (+45) plus name-match-against-URL-slug — capping them at
`possible`/`probable`, never `verified`, which is honest: we genuinely
can't verify a walled profile from a same-site crawl alone. Non-walled
platforms (GitHub, YouTube, Crunchbase, G2, etc.) get a real fetch via the
ported `fetcher.verifyUrl()` and can reach the full signal set, including
`verified`. `not_found` (no candidate cleared 40) beats inventing a
profile, per the spec doc's explicit rule.

This keeps the proven crawl mechanics, satisfies the schema's
`verification_status` enum the way the original briefing specified it, and
avoids silently inventing a scoring formula that exists in neither source
verbatim.

### SERP fallback for platforms same-site discovery didn't find

Same-site discovery runs first. For platforms still missing afterward,
`PresenceSerpService.sweep(brand, domain, missingPlatforms[])` (ported
close to as-is, DB-free, built on the same ported `FetcherService`) runs
`site:<platform-host> "<variant>"` queries via the shared
`DataForSeoSerpService` client — also ported as-is (confirmed DB-free via
grep), the one SERP client every module that needs a Google result page
should share (the old repo consolidated two paid vendors down to this one
for exactly that reason). Brand-name variants are generated by
progressively stripping corporate suffixes (Partners/Group/LLC/etc.),
trying the first word alone, and a domain-derived token — longest/most-
specific tried first, stopping early once a confident hit lands for that
platform. Budget: `PRESENCE_SERP_MAX_QUERIES` (default 20) hard-caps
total queries across the whole sweep — this is a paid API. Results are
cached a full week (`site:` results don't change hour to hour) via the
same fetcher cache. Fails closed: no `DATAFORSEO_LOGIN`/
`DATAFORSEO_PASSWORD`, or `SWARM_ALLOW_LIVE` unset, returns a typed
"disabled" result rather than a guess or a silent skip.

**Critically, a SERP hit is a candidate, never an auto-confirmed
account** — a `site:instagram.com "Acme"` search returns real accounts
mixed with unrelated posts and same-named unrelated companies, and
`PresenceSerpService` itself only returns a 0–1 name-similarity score, not
a verification decision. **The similarity score is a pre-filter for
picking which candidate to bother verifying when a search returns several
for one platform — it never bypasses or substitutes for the point-table
scoring above.** A SERP-found URL goes through exactly the same
verification path as a same-site-discovered URL: fetched via
`fetcher.verifyUrl()` if the platform isn't walled, scored against the
same point table; walled platforms found via SERP cap at
`probable`/`possible` just like same-site-discovered ones, never
`verified`, for the same reason (can't fetch to confirm).

New env vars this adds: `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`,
`SWARM_ALLOW_LIVE` (must be `1` to allow live paid calls — a deliberate
kill switch, defaults to disabled), `PRESENCE_SERP_MAX_QUERIES` (optional,
default 20). Documented in the module README and `backend/.env.example`,
same as `REDIS_URL`.

**Keeping the `SWARM_ALLOW_LIVE` gate**: decided yes — it's cheap
insurance against a test/dev run burning real DataForSEO search credits,
and it costs nothing to keep (it's just an extra `ConfigService.get`
check ported alongside the credential check in the same file). Defaults
to `0`/unset in `.env.example`, so a fresh checkout never accidentally
makes a live paid call.

### LLM client: `AeoLlmService`

The Extract/Consolidate/Verify stages all call an LLM through
`this.llm.json(...)`/`this.llm.isAvailable()` in the old code — that
client is `aeo-audit/aeo-llm.service.ts` (284 lines), ported as-is
alongside the pipeline it serves. Confirmed DB-free (only dependency is
`ConfigService`). Prefers OpenRouter (`OPENROUTER_API_KEY`, model
configurable via `AEO_LLM_MODEL`, default
`deepseek/deepseek-v4.1-flash`) with an `ANTHROPIC_API_KEY` fallback the
old code also supports — this module only needs the OpenRouter path since
that's the credential actually available. No `SWARM_ALLOW_LIVE`-style
gate exists on this client (only a presence check on the API key) — not
adding one here, since LLM calls are the pipeline's core function (unlike
DataForSEO, which is a bounded, skippable enrichment step), so gating it
off by default would make the module non-functional out of the box rather
than just conservative about paid-search spend.

## Job orchestration: BullMQ, not a single long synchronous call

The old code's checkpoint/pause/resume design
(`SiteContextRunPausedException`, `resume()`, `buildUntilDone()`) exists
because that codebase had no job queue — it was driven by direct calls.
We have a job queue available, so the two concerns collapse into one:

- One BullMQ queue, `discovery`, one job per `discovery_runs` row.
- **Producer**: `ProjectsService.createProject` (or a discovery-module
  listener on project creation — see "Trigger" below) enqueues
  `discoveryQueue.add('run', { discoveryRunId }, { attempts: 3, backoff:
  { type: 'exponential', delay: 5000 } })`.
- **Consumer**: `@Processor('discovery') class DiscoveryProcessor extends
  WorkerHost`, whose `process()` runs the stage loop (see "Pipeline
  stages" below), checkpointing `discovery_runs.stage`/`status` after each
  stage completes and calling `job.updateProgress(stage)` for visibility.
- **The old exception-based pause becomes a re-enqueue, not something a
  caller must catch.** When the elapsed-time budget (`maxElapsedMs`,
  default 5 min, same as the old code) is hit mid-run, the processor
  enqueues a continuation job for the same `discoveryRunId` and returns,
  rather than holding one worker slot open for a potentially multi-hour
  pipeline (which would also trip BullMQ's stall detection).
- **Job-level retry (BullMQ `attempts`/`backoff`) is a different layer
  from page-level retry inside the extract stage** — job-level retry
  covers "the worker crashed or threw unhandled," page-level retry covers
  "this one page's fetch/LLM call failed." Don't conflate them.
- Reuses the same Redis instance the ported `fetcher` module's
  cache/rate-limiter already need (`REDIS_URL`) — one Redis config, two
  independent consumers of it (BullMQ's queue state vs. fetcher's
  cache/rate-limit state).

**New infra dependency, flagged explicitly**: this module requires a
Redis instance for both BullMQ and the fetcher's cache/rate-limiter,
which the auth and projects modules didn't need. Needs `REDIS_URL` added
to `backend/.env` and to any CI/local-dev setup instructions. Fetcher's
cache degrades gracefully (disabled, not broken) if Redis is unreachable,
per its own code — but BullMQ has no such fallback, so Redis is a hard
dependency for this module specifically.

`npm install --save @nestjs/bullmq bullmq` (the current, non-deprecated
package — not `@nestjs/bull`/`bull`).

## Trigger

Per the confirmed flow: admin creates a project (name + domain only,
already built). This module has **no client-facing UI trigger** — no
email goes out until the full Day-1 report (a later module) is ready.
`ProjectsService.createProject` creates a `discovery_runs` row
(`status: queued`) and enqueues the BullMQ job in the same request —
kept as a direct call from `ProjectsService` into a `DiscoveryService`
method (not an event bus — there's only one consumer today, and a
same-transaction direct call is simpler and equally correct until a
second module needs to react to project creation).

## Pipeline stages (ported from `aeo-context.service.ts`, adapted to BullMQ + our schema)

Stage order (exact, from the shipped code): `discover → inspect → select →
extract → reconcile → validate → social-discovery → external-enrich →
consolidate → gap-research → verify → compile`.

**Discover** — fetch homepage first. Sitemap discovery: read `robots.txt`
`Sitemap:` directives first; fall back to `/sitemap.xml`,
`/sitemap_index.xml`, `/sitemap-index.xml`, `/wp-sitemap.xml`,
`/sitemap/sitemap.xml` only if robots.txt names none. Walk sitemap-index
trees bounded at `MAX_SITEMAP_FILES=50`, `MAX_SITEMAP_DEPTH=4`. Group
same-origin URLs by parent-path "template" and keep `SAMPLES_PER_TEMPLATE
=2` per template so one large archive doesn't crowd out everything else.
Sort high-signal keyword paths first, cap the returned list at 20. If no
sitemap yields anything: homepage nav links (cap 15) → all homepage links
(cap 40) → a fixed guessed-path list (`/services, /solutions,
/what-we-do, /products, /pricing, /industries, /who-we-serve, /about,
/case-studies, /use-cases`). Dedup by normalized URL key AND by a
DJB2-style rolling-hash content fingerprint over the first 4000 chars of
normalized text (catches a catch-all route serving the same content under
many paths). `looksLike404()` heuristic catches soft-404s even on HTTP
200. Budget-gated throughout: `pagesSpent < maxPages(12) &&
requestsSpent < maxRequests(40)`, overall `maxChars` budget of 24,000.

**Inspect** — from already-fetched HTML, no re-fetch: meta description,
h1/h2/h3 (capped 20/page), `<html lang>`, JSON-LD blocks filtered to
`RELEVANT_JSON_LD_TYPES` (`Organization, Corporation, LocalBusiness,
ProfessionalService, Brand, WebSite, Product, Service, Offer,
AggregateOffer, SoftwareApplication, Person, Place, PostalAddress,
ContactPoint, FAQPage, Review, AggregateRating`) and `JSON_LD_FIELDS`
(`name, legalName, alternateName, description, url, logo, sameAs,
address, areaServed, contactPoint, founder, foundingDate,
parentOrganization, subOrganization, brand, makesOffer, offers,
knowsAbout, award, slogan, telephone, email`), capped 30 entities/page.
Classify each page's type via URL regex (see taxonomy above). Fetch
failures aren't excluded — they're still considered in Select, just
without title/heading signal.

**Select** — coverage-based, per "Page selection" above. Logs a coverage
quality flag if ≤1 category got filled.

**Extract** — two passes:
1. *Deterministic, always runs*: JSON-LD → identity/geography/org facts,
   excerpt = the literal raw JSON-LD field text (not a re-serialized
   JSON.stringify — quoting would never match verbatim later).
   Heading/hero-text heuristics → candidate services/valueProps, filtered
   by `isCandidatePhrase` (3–70 chars, 2–6 words, rejects nav/merchandising
   noise, percentages/numbers, trailing punctuation, filler-word openers,
   verb-heavy sentences).
2. *LLM batched pass*: 4 pages/batch, `MAX_BATCH_CHARS=8,000`/page-slice
   and cumulative, gated by the run's overall 24,000-char budget. System
   prompt (ported near-verbatim from the old code): extract ONLY facts
   stated in the page text, never from outside knowledge; every fact
   cites its exact source URL (validated against the batch's real URLs —
   a hallucinated source is dropped) and a verbatim excerpt ≤200 chars;
   fact types `explicit / strong_inference / weak_inference` (bias toward
   omitting over weak_inference); explicit negation check ("we do NOT
   offer X" must never yield a positive fact); pages classified
   `careers/press/partner/leadership` (`ORG_ONLY_PAGE_TYPES`) are barred
   from producing services/valueProps/businessModel/category/description
   facts but can still supply org facts. Fixed 23-field extraction list:
   `services, icp, valueProps, painPoints, outcomes, markets (ISO-3166
   alpha-2 only), category, vertical, description, legalName,
   alternateName, foundedYear, headquarters, officeLocation, languages,
   pricingModel, differentiator, leadership, certification, award,
   partner, technology, businessModel, contact`.

**Reconcile** — confidence formula (ported exactly):
`confidence = base(factType) + authorityBoost + corroborationBoost`,
clamped [0,1]:
- `base`: explicit 0.75, strong_inference 0.55, conflicted 0.3, weak_inference 0.35
- `authorityBoost`: +0.1 if the citing page's type is one of `homepage,
  about, pricing, leadership, security`, else 0
- `corroborationBoost`: `min(otherSourcesAgreeing, 2) × 0.05` (max +0.10)

"Singular" fields (`category, vertical, description, brand, legalName,
foundedYear`) with >1 conflicting value: mark ALL of them
`fact_type: conflicted` rather than silently picking one, and log a
conflict note.

**Validate** — the anti-hallucination backbone, ported as a deterministic
string check (no LLM): every fact's excerpt must appear verbatim (after
whitespace normalization: collapse whitespace, trim, lowercase) in its
cited page's stored content. See "What we persist per page" below for
exactly what that stored content includes and why.

**Social discovery** — per the reconciled design above.

**External enrichment** — targets a fixed 5-field list with zero facts at
all (`headquarters, foundedYear, leadership, certification, award`), max
2 searches × 3 results each, via DataForSEO. Same verbatim-excerpt
validation as Validate applies — no benefit of the doubt for external
sources. External facts are capped at `confidence: 0.6` regardless of
fact type (never treated as equal to a first-party explicit fact).

**Consolidate** — one LLM call per category with ≥1 validated fact (not
one call per category unconditionally — a zero-fact category costs no
call, gets a deterministic empty summary). `CATEGORY_FIELDS` map (exact,
ported):
```
identity: [brand, legalName, alternateName, foundedYear, category, vertical]
descriptions: [description]
offerings: [services, pricingModel]
positioning: [valueProps, differentiator, painPoints, outcomes]
customers: [icp]
geography: [markets, headquarters, officeLocation, languages]
organization: [leadership]
credibility: [certification, award]
go_to_market: [businessModel, partner, contact]
technology: [technology]
```
Prompt forbids inventing values, flags real conflicts (two facts that can't
both be true, not just two different offerings), lists which expected
fields for that category have zero facts (→ `missing_fields`).

**As built**, cleaning the value list itself — merging duplicates, dropping
marketing copy that is not a real value — is a **separate value-judgement
pass**, not part of the summary prompt: see "As built" item 9/10 above for
why, and `CANONICAL_VALUE_FIELDS` for which fields it applies to.

**Gap research** — runs after Consolidate, targets exactly the
`missing_fields` Consolidate flagged (deduped, capped at 5 fields), 2
searches × 3 results each via the same `runBoundedSearchExtraction`
engine as External enrichment. If anything new is found, Consolidate
re-runs once for the affected categories.

**Verify** — a second, separate LLM call that re-reads Consolidate's own
output against the evidence facts it was built from (not raw pages — the
Validate stage already did that check). Catches a technically-verbatim
quote that's actually about a customer/competitor mentioned in passing,
or that blends current+historical or first-party+third-party facts as one
statement. Can only remove a claim or apply a confidence penalty — never
add one.

**Compile** — assembles `profile_json` from all validated facts (dedup by
value, cap per field — core fields like services/icp/valueProps get up to
10-25 values, "expanded" identity/org fields cap at 10), resolves
singular fields by most-cited value, computes `identity.company_type`
(conservative: `unknown` if no legalName/brand found, `subsidiary` if the
declared org name shares no word with the project's on-record name, else
`company`), pulls confirmed/probable social profiles into
`digital_presence`, calls the completeness scorer (weights above).
`digital_presence` completeness is binary: 1 if any verified-or-better
social profile exists, else 0.

## What we persist per page — resolving the raw-HTML tension

The old code persists truncated raw HTML (`MAX_CACHED_HTML=80,000` chars)
alongside cleaned text (`MAX_CACHED_TEXT=30,000` chars) specifically
because the Validate stage checks excerpts against `text + html`
concatenated — JSON-LD-sourced excerpts only exist in the raw `<script>`
tag, which visible-text extraction strips out.

We decided not to store raw HTML in `discovered_pages` (cleaned content +
hash only — see schema below). Resolution: **persist cleaned visible text
in full, plus the JSON-LD blocks' raw text separately** (small — JSON-LD
blocks are typically a few KB, not the full page), not the whole page
source. The Validate stage's verbatim check runs against `cleaned_text +
json_ld_raw` instead of `text + html` — functionally equivalent for this
module's actual excerpt sources (heading/hero-text extraction only ever
quotes visible text; JSON-LD extraction only ever quotes JSON-LD text),
without carrying full raw HTML through the pipeline or into the DB.

## DB schema (4 tables — do not re-expand; see "Why only 4 tables" below)

### `discovery_runs`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| project_id | uuid fk → projects.id | |
| status | enum `DiscoveryRunStatus` (`QUEUED, RUNNING, PAUSED, COMPLETE, COMPLETE_WITH_GAPS, MANUAL_REVIEW_REQUIRED, FAILED`) | `COMPLETE_WITH_GAPS`/`MANUAL_REVIEW_REQUIRED` map to the spec doc's Definition-of-Done gates (identity confidence <0.80, or <80% of reachable Priority-1-equivalent pages analyzed) |
| stage | enum `DiscoveryStage` (the 12 stage names above) | current/last-completed stage, for BullMQ resume |
| pages_spent / requests_spent / chars_spent | int | budget tracking, mirrors the old run's counters |
| elapsed_ms | int | cumulative across job re-enqueues |
| overall_confidence | float, nullable | set on compile |
| overall_completeness | float, nullable | set on compile |
| profile_version | int, default 1 | bumped each full rerun for this project (no per-field version history — see below) |
| error | text, nullable | |
| notes | jsonb, default `[]` | coverage-quality flags, conflict notes, cost-tracking entries |
| started_at / completed_at | timestamptz, nullable | |
| created_at / updated_at | timestamptz | |

### `discovered_pages`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| project_id | uuid fk → projects.id | denormalized for direct project-scoped queries; also reused by the later Technical Audit module |
| discovery_run_id | uuid fk → discovery_runs.id | |
| url | text | |
| page_type | enum `PageType` (taxonomy above) | |
| classification_confidence | float | |
| priority_score | int, nullable | for audit/debugging of the selection stage, not itself used by a later scoring formula (selection is coverage-based, not score-sorted) |
| fetch_status | enum `PageFetchStatus` (`PENDING, FETCHED, FAILED, EXCLUDED`) | |
| cleaned_text | text, nullable | visible text only, no raw HTML |
| json_ld_raw | text, nullable | raw JSON-LD script blocks only (small), kept for verbatim validation of structured-data-sourced excerpts |
| content_hash | text, nullable | for future refresh-diffing; reused by Technical Audit |
| created_at / updated_at | timestamptz | |

No `deleted_at` — see "Soft-delete exception" below.

### `social_profiles`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| project_id | uuid fk → projects.id | |
| platform | text | e.g. `linkedin`, `github`, `crunchbase` |
| url | text | |
| discovery_method | enum `ProfileDiscoveryMethod` (`SAMEAS`, `LINK_SCAN`, `SERP`) | `SERP` = found via the DataForSEO fallback sweep after same-site discovery came up empty for that platform |
| score | int, nullable | our point-table score; null for walled platforms with no fetchable signals beyond "official site links to it" |
| verification_status | enum `SocialVerificationStatus` (`VERIFIED, PROBABLE, POSSIBLE, REJECTED`) | per the reconciled scoring design above |
| verified_at | timestamptz, nullable | |
| created_at / updated_at | timestamptz | |

No `deleted_at`.

### `company_context_profiles`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| project_id | uuid fk → projects.id | |
| discovery_run_id | uuid fk → discovery_runs.id | |
| profile_json | jsonb | the Final Enriched Company-Context Schema, evidence-bearing fields throughout |
| overall_confidence | float | |
| overall_completeness | float | |
| version | int | matches `discovery_runs.profile_version` |
| created_at / updated_at | timestamptz | |

No `deleted_at`.

## Soft-delete exception (agreed with user)

These 4 tables are append-only/history tables, not business records like
`clients`/`users`/`projects`. A stale fact doesn't get `deleted_at` —
it's marked `status: stale` *inside* the JSON, and a new
`discovery_runs`/`company_context_profiles` row supersedes the old one on
the next run. Client edits during onboarding (a later module) are a
simple overwrite of the current `profile_json`, no version history beyond
the `version` integer already on the row. We are not bolting `deleted_at`
onto these 4 tables just for consistency with the rest of the codebase —
it doesn't fit an append-only/superseded-by-a-new-row model, and the user
explicitly agreed to this reasoning.

## Why only 4 tables (not the spec doc's 18, not the old repo's per-service tables)

The spec doc's own step 23 lists 18 suggested tables (`companies`,
`company_aliases`, `crawl_runs`, `pages`, `page_passages`,
`structured_data_entities`, `facts`, `fact_evidence`, `people`,
`locations`, `offerings`, `customer_segments`, `social_profiles`,
`social_candidates`, `external_sources`, `conflicts`, `research_gaps`,
`profile_versions`). This was the original proposal the user deliberately
cut down. The JSON-embedded evidence format (`evidence: [...]` inside
every field) replaces `facts`/`fact_evidence`/`conflicts`/`research_gaps`
as separate tables — conflicts and missing fields already live as arrays
inside `profile_json`. `profile_versions` is replaced by "a new
`discovery_runs`/`company_context_profiles` row supersedes the old one,"
consistent with the no-deleted_at/no-version-history decision above. Do
not re-expand this — a future module needing per-fact queryability (e.g.
"show me every page that mentioned pricing") can query `profile_json`
with Postgres JSON operators before justifying a new table.

## What's ported vs. built new

**Ported close to as-is** (DB-free infrastructure, confirmed via grep —
zero `PrismaService`/`prisma.`/`@InjectRepository` references anywhere in
the old `fetcher/` module):
- `fetcher/fetcher.service.ts` — single entry point (`fetch()`, `probe()`,
  `render()`, `fetchSchema()`, `verifyUrl()`).
- `fetcher/services/{cache,rate-limiter,retry,robots}.service.ts` —
  cache is pure Redis (`ioredis`, graceful disable if Redis unreachable,
  no DB fallback), rate-limiter likewise, retry is a circuit breaker,
  robots is a clean deterministic parser/matcher (`isAllowed`,
  `filterAllowed`, longest-match Allow/Disallow precedence, fails open on
  fetch/parse failure).
- `fetcher/clients/{http-client,browser-client}.service.ts`.
- `fetcher/services/cost-tracker.service.ts` — pure in-memory `Map`, no DB.
- `aeo-audit/aeo-llm.service.ts` (`AeoLlmService`) — the LLM client every
  extraction/consolidation/verification stage calls; confirmed DB-free.
- `serp-intelligence/dataforseo-serp.service.ts` (`DataForSeoSerpService`)
  — the shared SERP client, confirmed DB-free, built on the ported
  `FetcherService` for its own caching (1-week TTL for `site:` queries).
- `digital-presence/presence.serp.service.ts` (`PresenceSerpService`) —
  the brand-variant-generating SERP sweep for missing social platforms,
  built on `DataForSeoSerpService`.
- **Explicitly excluded from the port**: `fetcher/adapters/psi.adapter.ts`
  (PageSpeed Insights) — not part of the spec, belongs to the later
  Technical Audit module's performance concerns, not company context.

**Ported with adaptation** (algorithm logic, persistence layer rewritten
for our 4-table schema):
- The entire `aeo-context.service.ts` staged pipeline — see "Pipeline
  stages" above. Persistence calls (`persistFact`, checkpointing) are
  rewritten against `discovery_runs`/`discovered_pages`/
  `company_context_profiles` instead of the old `SiteContext`/
  `SiteContextRun` models. The exception-based pause/resume becomes
  BullMQ job re-enqueue (see "Job orchestration" above).
- `digital-presence/presence.discovery.service.ts`'s `crawl()` — same-site
  social discovery mechanics, per "Social profile verification" above.
  Its `verify()` is *not* ported as-is (it produces a 4-state enum with no
  score); our own scoring pass replaces it.
- `entity-audit.service.ts`'s `WALLED_HOSTS` list and `flattenSchemas()`
  (handles `@graph`-nested JSON-LD) — small, reusable helpers.

**Explicitly not ported**:
- `business-profile/business-profile.service.ts` in its entirety. Despite
  being named in the original briefing as the extraction/consolidation
  source, it turned out (on actually reading it) to be a human-
  confirmation/draft-versioning/onboarding-checklist workflow layer with
  no crawl or extraction logic of its own — the real extraction engine is
  `aeo-context.service.ts`. Nothing in `business-profile.service.ts` is
  reused.
- `intake/intake.service.ts` in its entirety — a shallower, single-page
  (homepage-only) enrichment that predates/duplicates what the full
  pipeline does properly. Its small heuristics (`deriveCategory()`,
  brand-name-inference chain, `TLD_COUNTRY` map, competitor-extraction
  regex) are candidates for reuse in a *later* module (competitor
  seeding), not this one.
- `website/` module in its entirety — confirmed GSC/GA4-dependent (its own
  header: "unified read model over technical checks, Google Search
  Console, Google Analytics"). Confirmed via grep that none of the ported
  modules import from it.
- `page-analysis/page-analysis.service.ts` — this is AEO-extractability
  *copy scoring* for an already-known URL (BLUF-window, question-H2
  share, etc.), not page-type classification. Not needed for this module;
  may be relevant to a later AEO module.

## Deferred out of this module (documented so a later module doesn't silently reinvent)

- The spec doc's parallel human-readable Markdown/HTML report (step 23's
  "Definition of Done" includes producing both JSON and Markdown) — the
  original briefing only asked for "a synthesized profile" (the JSON).
  Deferred to whichever later module actually renders a report.
- Multilingual-site handling, marketplace/franchise entity separation,
  and the doc's more exotic edge cases (Section "Error handling / edge
  cases") — noted as real scenarios the pipeline doesn't special-case yet;
  not blocking a first working version.

## Testing plan

Same rigor as auth/projects: unit tests per stage function (mocked
fetcher, mocked LLM calls) plus a live end-to-end run against a real test
domain, inspecting the resulting `profile_json`, with all test rows
(`discovery_runs`, `discovered_pages`, `social_profiles`,
`company_context_profiles`, plus the `projects`/`clients` rows created to
attach them) deleted afterward — same discipline as every prior module.
Given the pipeline's size, tests are organized per stage (discover/select/
extract/reconcile/validate/consolidate/verify each independently
testable against fixed input fixtures) rather than only end-to-end.
Live verification additionally confirms: the SERP fallback only queries
for platforms same-site discovery didn't find (not a full re-search), and
`PRESENCE_SERP_MAX_QUERIES` is actually respected as a hard cap.
