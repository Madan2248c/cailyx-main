# Competitors module

Given a project's tracked `Competitor` rows, builds a lightweight profile
per competitor (tech stack, schema markup, homepage SEO score **on the
same rubric the client is scored by**, review rating where findable) and
produces a deterministic client-vs-competitor gap comparison. See
`docs/analysis/competitors.md` for the full design.

## Reuses the existing `competitors` table — never a second list

AEO Audit already built `Competitor` as the single source of truth,
fixing the old repo's seed-JSON-column + untracked-candidates split that
never synced. This module reuses that exact table. `CompetitorSource`
gains one value, `serp_discovered`, alongside the existing `manual` /
`stance_discovered` — everything else about the table is unchanged.

## Discovery: two automatic sources, no staff-curated list

1. **AEO Audit's `stance_discovered` rows** — already populated by stance
   judging whenever an LLM names a rival in an answer. No new work here.
2. **SERP discovery** (new): a small, bounded set of category-level
   queries (company type / first industry / first service — pulled from
   the project's own `CompanyContextProfile`, never hand-typed) run
   through Discovery's existing `DataForSeoSerpService` (now exported for
   reuse — same credentials, same cache, same `SWARM_ALLOW_LIVE` gate, no
   second DataForSEO integration). Every distinct ranking domain other
   than the project's own is upserted as `Competitor(source:
   serp_discovered, status: candidate)`.

A manual add (`POST /competitors`) stays as a fallback for a rival the
automatic paths miss, but is not the primary path.

## Architecture

```
modules/competitors/
  competitors.module.ts             # wiring; exports CompetitorsService only
  competitors.constants.ts          # fetch timeout/cache, SERP query bounds
  competitors.types.ts              # TechSignature, DomainProfile, etc.
  tech-stack.signatures.ts          # ~90 deterministic signatures, ported verbatim
  controllers/
    competitors.controller.ts       # project-nested discover/create/list/gap
  dto/
    competitors.dto.ts              # manual-add body
  services/
    competitors.service.ts          # orchestrator: discover, create, list, gap
    serp-discovery.service.ts       # category-level queries → distinct ranking domains
    homepage-profiler.service.ts    # one fetch → tech stack + schema + SEO score + reviews
    tech-stack-detector.ts          # pure signature matcher, no I/O
    review-rating.ts                # pure AggregateRating JSON-LD parser, no I/O
```

Imports `DiscoveryModule` (for the now-exported `DataForSeoSerpService`)
and `AeoAuditModule` (read-only, for `Competitor` rows + the latest
verdict's `competitorStanding`) — never their Prisma models directly,
same discipline as Gap Analysis's own collectors.

## One fetch serves everything

`HomepageProfilerService.profile(domain)` does exactly one fetch, then:

- **Tech stack**: `detectTechStack()` runs all ~90 signatures against
  that fetch's headers, raw HTML, `<script src>` URLs, and `<meta
  name="generator">`. Zero vendor cost, works against any domain.
- **Schema types**: Technical Audit's own `extractPageSignals()` already
  extracts every distinct JSON-LD `@type` on the page — reused as-is, so
  this needed no new JSON-LD walker.
- **SEO score**: `findPageIssues()` + `scorePage()` from Technical
  Audit's `seo-rubric.ts`, run against the same `extractPageSignals()`
  output — **the same function** the client's own Technical Audit runs
  use, not a re-implementation. Homepage only; the full 8-check pipeline
  stays project-scoped, per the analysis doc's explicit exclusion.
- **Review rating**: `extractAggregateRating()` walks the same fetch's
  JSON-LD for an `AggregateRating` block (top-level or nested under a
  parent entity). **Known gap**: no review-site URL (G2/Trustpilot/
  Capterra) is auto-discovered for a competitor in v1 — this only finds
  a rating the homepage itself embeds, which is common for
  `LocalBusiness`/`Product` schema but won't catch a rating that lives on
  a separate G2 page. The parser is written domain-agnostic so a future
  pass that knows a specific review-site URL can reuse it unchanged.

A fetch that's blocked, times out, or 4xx/5xxs returns a `FAILED`
profile with `error` set — never a thrown exception. Same discipline as
Technical Audit's own checks: an unreachable competitor site is a
reportable outcome, not a crash.

## The project's own domain gets profiled too

`discover()` profiles the project's own domain through the exact same
`HomepageProfilerService.profile()` call, persisted as a
`CompetitorProfile` row with `competitorId: null`. This is the first
place in the whole rebuild that the client's own tech stack gets
recorded — Technical Audit's 8 checks never included tech-stack
detection. Without this, `/gap` would have nothing of the client's own
to compare a competitor profile against.

## `/gap`: deterministic diff, no LLM

`getGap()` returns `{ own, competitors: [...] }` — each row's latest
profile (tech stack, schema types, SEO score/issues, review rating) plus
AEO standing. AEO standing is read **live** from the latest completed
AEO Audit's verdict (`getVerdict()`, recomputed fresh, never a cached
blob) — matched to a `Competitor` by normalized name, since
`competitorStanding` carries no id of its own. No LLM judgment anywhere
in this path — counted/compared numbers only, same discipline as Gap
Analysis and AEO Audit's narrative. Only `status: tracked` competitors
are compared — a `candidate` row (freshly SERP-discovered, not yet
operator-confirmed) doesn't appear until promoted, via AEO Audit's
existing `Competitor.status` endpoint (no duplicate status route here).

## Public API

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/team/clients/:clientId/projects/:projectId/competitors/discover` | ADMIN | SERP discovery + AEO's existing rows, profiles every tracked competitor + the project's own domain; spends a small DataForSEO query cost |
| POST | `/team/clients/:clientId/projects/:projectId/competitors` | ADMIN | manual add fallback, `{ name, domain? }`, `source: manual` |
| GET | `/team/clients/:clientId/projects/:projectId/competitors` | `view_projects` | tracked competitors + each one's latest profile |
| GET | `/team/clients/:clientId/projects/:projectId/competitors/gap` | `view_projects` | deterministic client-vs-competitor comparison |
| POST | `/team/clients/:clientId/projects/:projectId/competitors/manual` | `manage_client_settings` | client adds a missing rival (onboarding), same body as the admin add |
| PATCH | `/team/clients/:clientId/projects/:projectId/competitors/:id` | `manage_client_settings` | client fixes name/domain or confirms (`tracked`) / demotes (`candidate`) a rival (onboarding) |

## Env

`DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` — **already existed** in this
repo (Discovery's own SERP fallback sweep uses them); not a new addition,
despite the analysis doc listing them as new. Same `SWARM_ALLOW_LIVE`
gate as every other DataForSEO call in this codebase.

## Testing

`detectTechStack()` and `extractAggregateRating()` are pure and tested
directly (signature matching across all four signal types, malformed
JSON-LD never throwing, nested `AggregateRating`). `HomepageProfilerService`
tested against a mocked `FetcherService` (FAILED on non-2xx/thrown
error, a full OK profile with real tech/schema/score output, domain
normalization). `SerpDiscoveryService` tested against a mocked Prisma +
`DataForSeoSerpService` (skip with reason when no profile/no grounding
terms, query construction, own-domain exclusion, partial-skip handling).
`CompetitorsService` tested with every collaborator mocked (dedup on
discover, own-domain profiling, gap comparison's own/competitor
separation, AEO-standing-null-without-a-completed-audit,
tracked-only filtering). Controller pass-through covered. One live
end-to-end run against a real project (real DataForSEO spend, confirmed
small) is recorded in `docs/chagelog.md`.
