# Changelog

Running record of what shipped, how it was verified, and what it left for
later. Newest first.

## 2026-09-25 — Technical Audit module: orchestrator, queue, API, staff UI

Resumed from the rate-limited `builder` session (`4090ece8`), which had
finished the eight checks, the SEO rubric, deltas, PSI/narrative services
and the DB schema but stalled with two check-building forks unfinished and
no orchestrator, queue, controller, module, or frontend.

**What was built**: `TechnicalAuditService` (sequential checks, per-check
isolation, sitemap-gated page-inventory, renormalizing composite, previous-
run diff chain, chunked `audit_pages` writes, post-persist narrative),
BullMQ `technical-audit` queue (concurrency 1, one job per run) +
`TechnicalAuditScheduler` (`upsertJobScheduler` with `every` intervals for
WEEKLY/MONTHLY, `MANUAL_ONLY` removes), staff controllers nested under
client/project, `TechnicalAuditModule` wired into `AppModule`, module README, API
reference, status tables.

**Verified**: `tsc` clean both projects, backend 436 tests green (103 in
technical-audit, incl. 13 new for orchestrator/controller/scheduler),
frontend lint + `tsc` clean. **Open**: one live end-to-end run against a
real domain (temp rows deleted afterward), including confirming the
scheduler's completion-time semantics across a real re-schedule.

## 2026-09-25 — Discovery module: cleaned-up offerings/positioning values

Follow-up to the module below, after the user reviewed the live profile and
flagged that `offerings.services` and `positioning` mixed real capabilities
with marketing copy ("Integrate tonight", "Write using a delightful editor",
"Beyond expectations" sitting next to actual product features) and repeated
one claim under several phrasings.

**What changed**: the extraction prompt now explicitly excludes calls to
action, benefit/quality claims, slogans and section headings from `services`,
and restricts `valueProps`/`differentiator` to the company's own words (never
a customer testimonial or another company's executive quoted on the page).
Consolidation gained a **second, separate LLM call per category** — a
value-by-value keep/drop judgement — because the summary call alone could not
clean the list: asked to edit a list, the model returned every value
unchanged; asked to judge one value at a time, it correctly dropped 14 of 28
noisy values on the same input. `compile` now assembles offerings/valueProps/
technology/etc. from this judged canonical list rather than the raw extracted
values, with identity fields (brand, legalName, category, …) deliberately
exempt — list-level filtering never applies there, since dropping a value
there costs the profile its identity rather than tidying a list.

**A real defect was found and fixed mid-tuning**: the first version of the
judgement pass capped each category at 40 values before judging and silently
kept everything past the cut unjudged. On resend.com's 76 unique `services`
values, that meant the back half of a real offerings list — headings, CTAs,
price lines — passed straight through regardless of what it actually was.
Fixed by chunking instead of truncating: a category judges in as many calls
as it needs, and every value is judged. Caught only by running the redesigned
stage against real extracted facts (no site traffic — the facts were already
saved from an earlier live run); the unit fixtures never had enough distinct
values to hit the cap, which is now itself a regression test.

**Measured effect** on the resend.com profile: `offerings.services` went from
74 values (marketing copy interleaved with real capabilities, nothing
filtered) to 43 (every CTA, slogan, price line and section heading removed —
`Frequently asked questions`, `Start sending tonight`, `Try it today $0/mo`,
`Analyze and track performance`, `Ready for every use case`, and the rest, all
gone); `positioning` went from 27 to 10, including correctly dropping a
customer testimonial ("switching from SendGrid marked a significant
improvement") that had been read as the company's own differentiator.

11 new tests (222 in the module, 321 across the backend), including the
chunking regression. `tsc`/lint/build green. No live crawl was run for this
change — verification was against facts a prior live run already produced.

## 2026-09-25 — Discovery / company-context module

Stage 1 of the Day-1 pipeline. Given a project's domain, crawls its site and
produces an evidence-backed company-context profile — every material field
carrying a value, a fact type, a confidence, and the quotes that support it.
Design and rationale: `docs/analysis/discovery.md` (which records the six
places the build departs from the original design); operational notes:
`backend/src/modules/discovery/README.md`.

**DB**: four append-only tables (`discovery_runs`, `discovered_pages`,
`social_profiles`, `company_context_profiles`) plus their enums. Deliberately no
`deleted_at` — a stale fact is marked inside the JSON and a new run supersedes
the row; agreed with the user, and documented so it is not "fixed" later. Two
`pipeline_state` jsonb columns hold in-flight pipeline state (reconciled facts,
category summaries, per-page metadata and facts) so a re-enqueued job resumes
instead of re-spending LLM calls. Three migrations, applied to the Supabase
instance.

**Backend**: a twelve-stage pipeline (discover → inspect → select → extract →
reconcile → validate → social-discovery → external-enrich → consolidate →
gap-research → verify → compile) running on a BullMQ `discovery` queue, one job
per run. Long runs pause on an elapsed-time budget and enqueue their own
continuation — the caller never catches a "paused" exception, which is what the
old repo's HTTP-driven design required. Ported alongside: the whole
`fetcher/` module, the LLM client, the shared DataForSEO SERP client, and the
digital-presence discovery/SERP services. `ProjectsService.createProject` starts
a run in the same request; it never fails project creation if the queue is down.

**Frontend**: none, by design — the module has no client-facing trigger, and
nothing is shown to the client until the Day-1 report module exists.

**Tests**: 307 passing across 28 spec files (up from 98/12), the new ones
organised per stage over mocked Prisma/fetcher/LLM/search clients. The suite
caught two real defects, both fixed and now pinned by regression tests: the
social scoring's own-domain guard read a capture group that does not exist (so a
profile naming the client's *own* domain took the −40 penalty meant for other
companies), and consolidate's no-LLM path reported every field missing after a
successful extraction, scoring 0 completeness.

**Verified live** against `resend.com`, twice (2026-09-25): a real crawl, real
LLM extraction and consolidation, no paid search (`SWARM_ALLOW_LIVE=0`), about
$0.005 of OpenRouter credits per run. Every row created was deleted afterwards —
confirmed by counting all four tables back to zero, plus the temp client and
project.

- The pipeline ran end to end, including the budget pause and the continuation
  job that resumes it, and the SERP fallback correctly *refused to run* for the
  two platforms same-site discovery did not find rather than assuming them
  absent.
- The first run found two defects, both fixed here and re-verified by the second
  run: extraction stopped silently when the elapsed budget ran out, so four of
  six selected pages were never extracted (now 4/6, with the remainder limited
  by the character budget, and the stage signals a pause instead of completing);
  and a `Product` JSON-LD block named the brand, which made the profile's own
  business name a conflict — the run's business_name went from `conflicted` at
  0.50 to `explicit` at 0.95, and overall confidence from 0.74 to 0.82.
- Still true of every run and worth knowing before reading a profile: the
  identity gate flags any site that publishes no legal name (0.60 →
  `MANUAL_REVIEW_REQUIRED`, so the flag is common rather than exceptional); the
  24,000-character extraction budget covers only about three to four pages at
  the default per-page slice, so a twelve-page crawl is deliberately partial
  (raise `DISCOVERY_MAX_CHARS` to change that); and the independent verification
  pass can come back non-JSON on a large payload, in which case the run says so
  in its notes and keeps the consolidated summaries unverified rather than
  failing.

**Left for later**: a human-readable Markdown/HTML report, multilingual-site
handling, marketplace/franchise entity separation, and per-run cost reporting —
`__cost__` notes on the run are currently the only cost record. The schema
sections with no fact source yet (`products`, `buyer_roles`, `team_size`,
`testimonials`, …) stay empty and surface as `missing_fields` rather than being
filled with something plausible.

## 2026-09-25 — Projects module

New foundational module: a client can have multiple projects
(domains/brands). The Day-1 report pipeline and every module after it will
key off a project, not a client directly — see `docs/analysis/projects.md`
for full rationale.

**DB**: new `projects` table (`client_id`, `name`, `domain`, `created_by`,
soft-deletable), a partial unique index on `(client_id, domain)` WHERE
`deleted_at IS NULL`, and a new `view_projects` permission seeded onto
`CLIENT_POC` and `CLIENT_MEMBER`.

**Backend**: `ProjectsController` nested under
`/team/clients/:clientId/projects` (`POST`/`GET`/`PATCH .../:id/archive`),
reusing the auth module's `JwtAuthGuard`/`RolesGuard`/`PermissionsGuard`.
Creation is admin-only (matches the product diagram); listing is admin, or
that client's own POC/members via the new permission, scoped to their own
`clientId`. Domain is normalized before every insert/lookup (lowercase,
strip protocol/`www.`, hostname only, drop trailing `.`/`/`) so
`https://WWW.Acme.com/pricing` and `acme.com` collide as the same domain.
Archiving (soft delete) frees the domain up for reuse.

**Frontend**: new `/admin/clients/:id` page listing a client's projects
with a create dialog (name + domain) and an archive action; `/admin/clients`
gained a "Projects" button linking to it.

11 new unit tests (98 total across 12 spec files). Verified live end-to-end
against the Supabase instance (temporary test client/admin rows, deleted
afterward): domain normalization on create, duplicate-active-domain
rejection, cross-tenant isolation (a second client's POC gets `403` both
listing and creating), archive + domain-reuse-after-archive.

## 2026-09-25 — Auth module: per-client seat limits

`clients.seat_limit` (integer, default 1, `CHECK >= 1`), counting the POC as
a seat. Enforced in `TeamService.inviteTeamMember` (rejects with `400` when
`seatsUsed >= seatLimit`); admin-adjustable via `PATCH /team/clients/:id/seats`.
`GET /team/clients` and `GET /team/members` now both report `seatLimit` +
`seatsUsed`. This is auth-module *configuration*, deliberately distinct from
the deferred per-client product-feature toggles (see "every feature is a
plugin" in `docs/context.md`, added the same day) — seats are an auth-module
concern, not a feature flag.

Frontend: `CreateClientDialog` gained a seat-limit input (default 1); new
`EditSeatsDialog` for admins to change it later; `/admin/clients` shows
"X / Y seats" per client; `/team` shows the POC's own usage and hides the
invite button once at the limit.

5 new/updated unit tests (87 total). Verified live end-to-end through the
actual `/api/team/*` Next.js proxy (not just the backend directly): created
a client at `seatLimit=1`, confirmed the 1st team-member invite succeeds and
the 2nd is rejected, confirmed an admin raising the limit immediately
unblocks further invites, confirmed `seatLimit=0` is rejected by validation.

## 2026-09-25 — Login module complete

**DB**: 7 tables (`clients`, `users`, `permissions`, `role_permissions`,
`client_feature_flags`, `auth_tokens`, `refresh_tokens`), all soft-deletable.
Fixed `Role` enum with permissions as data (`role_permissions`), a partial
unique index enforcing exactly one active POC per client, and a `CHECK`
constraint tying `client_id` nullability to role. Full rationale in
`docs/analysis/auth.md`.

**Backend**: Prisma + `@prisma/adapter-pg` wired into NestJS following the
official docs pattern. Two controllers:
- `AuthController` — login, refresh (with rotation + reuse-detection that
  revokes the whole session chain), logout, accept-invite, forgot/reset
  password, `/me`, plus `*/validate` read-only token checks.
- `TeamController` — admin creates clients + invites POCs, POC invites/
  manages their own team, admin suspends/activates clients. Guarded by a
  `RolesGuard` (hardcoded, for platform-level actions) and a
  `PermissionsGuard` (checks `role_permissions` in the DB, so future roles
  inherit access purely by being granted a permission).

argon2id hashing, JWT access tokens (15 min) + opaque DB-backed refresh
tokens (30 days), 5-attempt/15-min lockout. Verified end-to-end against the
live Supabase instance repeatedly — see module README for the full test
list.

**Frontend**: Next.js App Router, shadcn/ui (Base UI variant). BFF pattern —
`/api/auth/*` and `/api/team/*` route handlers proxy to the backend
server-side; the refresh token lives only in an `httpOnly` cookie, never in
client JS. Pages: `/login`, `/accept-invite`, `/forgot-password`,
`/reset-password`, `/dashboard`, `/admin/clients`, `/team`.

**Bugs found and fixed during manual testing**:
- Reusing an already-consumed invite/reset link still rendered the
  password-setting form (only failed on submit). Added
  `/auth/*/validate` endpoints and check them server-side before rendering.
- `<Button render={<Link/>}>` triggered a Base UI console error — `Link`
  renders an `<a>`, not a `<button>`; needed `nativeButton={false}`.

**Known gaps, deferred on purpose**:
- No email sending — invite/reset links are logged to the console.
  Plunk credentials are in `.env` but sending fails without a verified
  sender configured in the Plunk dashboard.
- No UI/API for `client_feature_flags` (table exists, nothing reads/writes
  it yet).
- No Swagger/OpenAPI decorators — `docs/Readme.md` is the API reference for
  now.
- No HTTP-level e2e tests — see the unit test suite added below for what
  *is* covered.

## 2026-09-25 — Auth module unit tests

82 tests across 10 spec files (`npm run test`), following
[NestJS's testing docs](https://docs.nestjs.com/fundamentals/testing):
`Test.createTestingModule` with mocked `PrismaService` (shared factory in
`test/mocks/prisma.mock.ts`) / `PasswordService` / `TokenService` /
`ConfigService`. Covers `AuthService`, `TeamService` (including cross-tenant
scoping and self-action guards), the three guards, and both controllers
(delegation only — guards overridden via `overrideGuard()` since
`TestingModule.compile()` eagerly instantiates classes named in
`@UseGuards`). `PasswordService`'s tests run real argon2 hashing, no mocks.

Still no HTTP-level e2e tests exercising the real request pipeline
(validation pipes, guards actually running) — these are unit tests only.
