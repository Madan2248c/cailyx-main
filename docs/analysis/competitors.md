# Analysis — `competitors` module

Status: **approved (2026-09-27) — build now, before Reporting/Day-1 pipeline.**
Nothing built yet.

## What this closes

Surfaced as a gap while drafting `docs/analysis/reporting.md`: the old
codebase had a dedicated `competitors` module that this rebuild's plan had
completely missed. It's distinct from what AEO Audit already tracks:

| | AEO Audit's `Competitor` (existing) | This module (new) |
|---|---|---|
| Answers | who gets named/recommended over the client **inside answer-engine responses** | what do our competitors **actually run**, and where do they **already beat us on SEO/content/reviews** |
| Data | mention/stance co-occurrence from LLM judgments | tech-stack scan, schema/JSON-LD, homepage SEO score on the **client's own rubric**, review ratings |

**The `competitors` table already exists** (`backend/prisma/schema.prisma`,
built by AEO Audit as the single source of truth after the old repo's
seed-JSON-column + untracked-candidates split never synced). This module
**reuses that exact table** — it does not create a second competitor list.
Recreating that split is the specific mistake to not repeat here.

## How competitors actually get identified (corrected 2026-09-27)

Per operator clarification: discovery is **not** a staff-curated list.
It's two automatic sources, both landing in the same `competitors` table:

1. **AEO Audit's existing `stance_discovered` path** (already built,
   nothing new here) — whoever gets co-mentioned in an LLM's answer
   alongside the client, during measurement, is upserted as a
   `Competitor` row. This is already live.
2. **SERP discovery (new, this module)** — a small set of basic,
   category-level search queries (reusing the terms Discovery/Query Set
   already know about the client's services/category, not hand-typed per
   project) run through **DataForSEO's SERP API** (approved 2026-09-27).
   Every distinct domain that ranks, other than the client's own, is
   upserted as a `Competitor` row with `source: serp_discovered`.

**`CompetitorSource` gets a third value**: `manual` (existing) /
`stance_discovered` (existing) / `serp_discovered` (new). A manual
add-by-staff path can still exist as a fallback for a rival the automatic
paths miss, but it is not how this is meant to work day-to-day.

## Scope

Given a project's tracked `Competitor` rows (populated by AEO Audit's
`stance_discovered` path and this module's own `serp_discovered` SERP
queries), build a lightweight profile per competitor: tech stack, schema
markup, homepage SEO score (same rubric the client is scored on), and
review ratings where findable. Produce a plain client-vs-competitor
comparison — no LLM judgment, counted/diffed numbers only, same discipline
as the rest of the pipeline.

Explicitly out of scope (per old repo's own decision, kept): running the
full 8-check Technical Audit pipeline per competitor. That stays
project-scoped; making it domain-scoped is its own future decision, not
this one.

## Tool choice — SERP discovery (the one new external dependency)

| Option | Pricing | Notes |
|---|---|---|
| **DataForSEO (chosen)** | ~$0.0006–0.003/query, pay-as-you-go | Also the vendor already named in the old codebase's backlinks integration — one account if that's ever rebuilt here. Broader data (Ads/Trends) available if this module's needs grow. |
| SerpApi | ~$0.005–0.015/query, subscription tiers | Simple JSON, well-documented, no overlap with anything else in this codebase. |
| Serper.dev | ~$0.0003–0.001/query, 2,500 free/month | Cheapest, minimal feature set — search results only. |

**Decision (2026-09-27): DataForSEO.** New env var: `DATAFORSEO_LOGIN` /
`DATAFORSEO_PASSWORD` (their auth scheme is basic-auth login/password, not
a single API key) — add to `.env` and `.env.example`. Query volume is
small and bounded: a handful of category-level queries per project, not
per-prompt, so cost stays negligible relative to Measurement's own spend.

## Everything else reuses what's already built — no other new tool

- **Tech-stack detection**: ported from the old repo's `tech-stack` module
  — a deterministic, in-repo signature table (~90 entries, 10 categories:
  analytics, CRM, chat widgets, CMS, hosting, CDN, ecommerce, tag
  managers, A/B testing) matched against one homepage fetch's `<script
  src>` URLs, `<meta name="generator">`, raw HTML, and response headers.
  Zero vendor API, zero cost, works against any domain — which is exactly
  why it doubles as both "what do we run" and "what do they run." Built
  as a small internal piece of this module (not a separate approval-gated
  module — there's no tool choice to make, it's a ported constant table).
- **Schema/JSON-LD read**: the same homepage fetch already used for
  tech-stack detection is parsed for its JSON-LD `@type` values — one
  fetch serves both.
- **SEO score**: reuses Technical Audit's existing `seo-rubric.ts` +
  `page-signals.ts` (pure, deterministic, already built) against the
  competitor's homepage HTML from the same single fetch. This is what
  makes "same rubric the client is scored by" literally true — it's the
  same function, not a re-implementation.
- **Reviews**: same fetch+schema-parse utility, pointed at a review-site
  URL (G2/Trustpilot/Capterra) if one is known for the competitor, reading
  its `AggregateRating` JSON-LD. No scraping API, no ToS-risk crawl —
  schema markup only, same approach the old repo used.
- **AEO presence**: read-only from the project's latest completed AEO
  Audit verdict's `competitorStanding`, matched by `Competitor.id` — the
  same row, no duplicate lookup, no new AEO run triggered.

## Pipeline

```
1. Discover     (a) read AEO Audit's already-upserted stance_discovered
                rows for the project — no new work; (b) run a bounded set
                of category-level SERP queries via DataForSEO (terms drawn
                from Discovery's CompanyContextProfile / Query Set's own
                grounding — not hand-typed), upsert every distinct ranking
                domain other than the client's own as source:
                serp_discovered
2. Fetch        one homepage fetch per competitor domain (+ one for the
                project's own domain, so the comparison has a fair
                baseline — Technical Audit's 8 checks don't include
                tech-stack detection today, so this is the first time the
                project's own stack gets recorded)
3. Detect       tech-stack signature match against that fetch
4. Score        seo-rubric.ts against the same fetch's page-signals
5. Reviews      optional: schema-parse a known review-site URL, if present
6. AEO read     pull competitorStanding from the latest AEO Audit verdict
7. Persist      CompetitorProfile row per competitor (append-only —
                refreshing creates a new row, "latest" reads pick the
                most recent per competitor, same convention as Discovery/
                Technical Audit/Social Activity)
```

A fetch that's blocked, times out, or 4xx/5xxs is not an error — it's a
`fetchStatus: FAILED` profile with `error` set, same discipline as
Technical Audit's own checks (a site blocking bots is a reportable
finding, not a crash).

## Entities

### `competitors` — **existing table, reused, one enum value added**
(`id, projectId, name, domain, status, source` — see AEO Audit's schema).
`CompetitorSource` gains `serp_discovered` alongside the existing `manual`
/ `stance_discovered` — everything else about the table is unchanged.

### `competitor_profiles` (new)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| competitor_id | uuid fk → competitors.id, nullable | **null represents the project's own domain's profile** — same row shape used for both, so the gap comparison reads one table |
| project_id | uuid fk → projects.id | set on every row (including the client's own), so a query never needs to join through a nullable competitor_id |
| tech_stack_findings | jsonb | array of `{ category, name, evidence }` |
| schema_types | jsonb | array of distinct JSON-LD `@type` values found |
| seo_score | int, nullable | 0–100, from the shared rubric; null if fetch failed |
| seo_issues | jsonb | issues array, same shape `seo-rubric.ts` already produces |
| review_rating | jsonb, nullable | `{ source, rating, count }`; null if no review-site URL known or no `AggregateRating` found |
| fetch_status | enum (`OK`, `FAILED`) | |
| error | text, nullable | |
| created_at | timestamptz | |

Append-only, no `deleted_at` — consistent with the other audit-history
tables in this rebuild.

## API

| Method | Path | Notes |
|---|---|---|
| `POST` | `/team/clients/:clientId/projects/:projectId/competitors/discover` | runs SERP discovery (DataForSEO) + reads AEO's stance_discovered rows, upserts `Competitor` rows, queues a profile-refresh job per competitor + the project's own domain |
| `POST` | `/team/clients/:clientId/projects/:projectId/competitors` | manual add fallback, `{ name, domain }`, `source: manual` |
| `GET` | `/team/clients/:clientId/projects/:projectId/competitors` | list tracked competitors + each one's latest profile |
| `GET` | `/team/clients/:clientId/projects/:projectId/competitors/gap` | plain comparison table: client's own latest profile vs each competitor's — tech stack presence, SEO score delta, review rating, AEO standing. No LLM, deterministic diff only. |

Un-tracking a competitor reuses AEO Audit's existing `Competitor.status`
field/endpoint — no new endpoint duplicating that state.

## Env vars

| Var | Notes |
|---|---|
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | basic-auth credentials, new — add to `.env` and `.env.example` |

## Dependencies

- **Modules**: `PrismaModule` (global), Technical Audit (`seo-rubric.ts` /
  `page-signals.ts`, imported as pure functions — no service coupling),
  AEO Audit (reads `Competitor` rows + latest verdict's
  `competitorStanding`, read-only).
- **Consumers**: `reporting` (SOP-11) — the competitor comparison becomes
  a report section once this module exists, closing the gap flagged in
  `docs/analysis/reporting.md`.

## Build order note

This module was surfaced mid-way through drafting Reporting and is being
inserted ahead of it: `gap-analysis` (done) → **`competitors`** →
`reporting` → the Day-1 pipeline orchestrator. `reporting.md`'s "Known
gaps" section 1 should be marked resolved once this ships.
