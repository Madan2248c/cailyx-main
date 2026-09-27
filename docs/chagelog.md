# Changelog

Running record of what shipped, how it was verified, and what it left for
later. Newest first.

## 2026-09-28 — Google module (Search Console + Analytics) + Organic tab

Per-client OAuth (incremental scopes, refresh token AES-256-GCM at rest,
stateless signed state, no metrics stored) + live GSC overview (totals +
previous period, top queries/pages, daily) and GA4 overview (sessions,
users, pageviews, daily) with per-project domain matching. Migration
`add_google_connections`. Organic tab: connect cards (GSC unlocks, GA
adds on), KPI tiles with previous-period deltas, area charts, top
tables; POC-only connect, members read.

**Verified**: 14 backend tests (mocked), full suite 753 passed,
`tsc`/`oxlint`/`eslint` clean; live (unlinked account): status
all-false, real consent URL with signed state, honest 404
`google-not-connected`. Live grant still open: redirect URI registration
+ browser click-through (operator steps, see `docs/analysis/google.md`).

## 2026-09-28 — Discovery Step 20 synthesis: profiles written from understanding, not transcription

Implements the reference workflow's final synthesis (Call F) as a new
`SYNTHESIZE` stage (migration `20260927193551_add_synthesize_stage`):
after gap research, one small call per group reads the verified facts
like an analyst and writes descriptions (one_line/short/detailed),
offerings.services, the positioning lists and icp_summary in plain buyer
language. Every label fuses verbatim inputs (`basedOn`, enforced
deterministically — unmapped inputs survive verbatim, ungroundable labels
are dropped); verification now checks synthesized labels against their
cited evidence; compile assembles from verified synthesis with merged
evidence, falling back to verbatim paths whenever synthesis is absent.
No profile-shape change; existing profiles untouched (a re-run writes a
new version).

**Verified**: 8 synthesize + 3 compile + 1 verify tests, full suite 739
passed, `tsc`/`oxlint` clean. Takes effect on the next discovery run.

## 2026-09-28 — Discovery consolidate: voice guard + variant merging + auxiliary drop rule

Prompt-level fix for profile quality (business context read as raw
landing-page copy): the summary prompt now requires company voice (never
commentary on the evidence), the value judge merges capability variants
aggressively (keep fullest wording, rest `duplicateOf`) and drops
support/community/academy/success-team items from offerings fields.
`docs/analysis/discovery.md` updated to match. No schema change; pre-merge
behavior (fail-open keeps, exact-duplicate collapse) untouched.

**Verified**: new prompt tripwire test in `consolidate.stage.spec.ts`,
full suite 727 passed, `oxlint` clean. Takes effect on the next discovery
run — existing profiles are unchanged (append-only; a re-run writes a new
version).

## 2026-09-28 — Client onboarding wizard + client correction endpoints (DB, backend, frontend, tests, docs)

Prefilled, editable onboarding: the POC reviews everything the pipeline
found and corrects it in place — company-context fields, social profile
URLs, competitors — and the edits update the source tables directly.

**Backend**: `PATCH …/company-context` (`{fields: {section.field: …}}`,
whitelisted paths, scalars/arrays, 400 on unknown/kind-mismatch) applies
onto the latest profile row (corrected values keep `supported` status —
the client is authoritative; evidence stays for provenance);
`PATCH …/social-profiles/:id` corrects a URL and resets verification to
`POSSIBLE` (old proof no longer applies); `PATCH …/competitors/:id`
(name/domain/tracked|candidate, project-scoped) + `POST …/competitors/manual`.
All writes require `manage_client_settings` (POC-only); reads stay
`view_projects`. `POST /team/clients` gains opt-in `deferInvite` (silent
creation — the pipeline's ready email is the first invite).

**Frontend** (`frontend/`, shadcn/Base-UI): `/onboarding` 7-step wizard
(welcome, basics, offerings, customers, presence + socials, competitors,
review) prefilled from the latest project's company-context/socials/
competitors, per-step save, members get read-only + notice; new BFF
passthrough routes; `Textarea` kit piece; post-invite redirect lands on
`/onboarding`; dashboard links to review details.

**Verified**: 12 new backend tests (mocked), full suite 726 passed,
`tsc`/`oxlint`/`eslint` clean, plus live against the E2E Fello project:
POC PATCH + revert on all three surfaces, member 403s with data
unchanged, BFF GET/PATCH through Next.js, `/onboarding` serves 200.

## 2026-09-27 — Day-1 pipeline orchestrator: auto-chain, spend pre-auth, deferred invite, live e2e pending

Built from `docs/analysis/day1-pipeline.md` (operator calls: deferred
invite (A), ChatGPT-only Day-1 surfaces). New `day1-pipeline` module:
`Day1PipelineRun` row per project (migration
`20260927175118_add_day1_pipeline_module`), BullMQ `day1-pipeline` queue
(concurrency 1, 3 attempts), 9 stages run sequentially — Discovery →
Technical Audit → Social Activity → Query Set (generate → activate) →
AEO Audit → Competitors → Gap Analysis → Reporting (DAY1, auto-RELEASED)
→ notify. Only `reporting` is fatal; every other stage failure is
recorded and the pipeline continues (COMPLETE = report released).
Retries resume past recorded stages; `GET`/`POST …/projects/:id/day1[/retry]`
(admin) inspect and re-enqueue, rejecting COMPLETE/RUNNING rows.

**Spend**: project creation now requires `day1SpendConsent: true` (+
optional `day1SpendCeilingUsd`, enforced best-effort before the paid
stages off social/AEO reported costs); `DAY1_SURFACES` defaults to
`cloro_chatgpt`. **Invite**: `POST /team/clients` gains opt-in
`deferInvite` (silent creation); the pipeline's final step sends the
first invite with ready context (`TeamService.sendDay1ReadyEmail`,
ACTIVE POC → login-link email instead). **Trigger refactor**:
`ProjectsService.createProject` now starts the pipeline instead of
calling Discovery directly. Frontend: consent checkbox + ceiling on the
project dialog, defer checkbox on the client dialog (BFF passes through).

**Verified**: 13 orchestrator + 9 projects/auth-delta tests (mocked
stages/queues), full suite 714 passed, `tsc`/`oxlint`/`nest build` clean.
Live end-to-end run against a real domain deliberately deferred to the
scheduled full-repo E2E pass (real spend + 30–60 min wall-clock).

## 2026-09-27 — Email module (Plunk) + auth invite/reset delivery

Built from the approved `docs/analysis/email.md`. Thin leaf `EmailModule`
(`EmailService.send({to,subject,html})`, raw `fetch`, no SDK, no controller,
no persistence) with the spec's honest guards: unconfigured → 503
`email-unconfigured`, Plunk non-2xx/transport failure → 503
`email-send-failed`.

**Two live findings while verifying**: the current Plunk base URL is
`https://next-api.useplunk.com/v1/send` (the old `https://api.useplunk.com`
host now 401s), and `from` is mandatory (422 without it — the old API fell
back to the project sender). Both are documented in the module README.
Verified domain: `rothenhall.com`; sender `noreply@rothenhall.com`.

**Auth follow-up patch**: `AuthModule` imports `EmailModule`; invite
(`createClientWithPoc`/`inviteTeamMember`/`resendInvite`) and
`forgotPassword` now email real links (`FRONTEND_URL` +
`/accept-invite?token=…` / `/reset-password?token=…`, new env var defaulting
to `http://localhost:3000`). Failure semantics: reset keeps its generic
response either way (unconfigured → debug-logged token, send failure →
error-logged and swallowed — no enumeration, no leak); invite throws 503
on send failure (no silent loss, persisted invite retryable via resend).

**Verified**: 6 email + 4 new auth tests (mocked `fetch`/services), full
suite 688 passed, `tsc`/`oxlint` clean, plus a live curl send delivered to
a real inbox before building.

## 2026-09-27 — Reporting module (SOP-11): source assembly, editorial lifecycle, HTML render, live e2e (DB, backend, tests, docs)

Built from the approved `docs/analysis/reporting.md`. Reads the latest
completed run from every other audit module (Technical Audit, Social
Activity, AEO Audit, Competitors, Gap Analysis — via their own exported
services, no cross-module DB reads), assembles one report, renders it to
a standalone HTML page, and gates client visibility through an editorial
lifecycle that's independent of the report's `visibility`
(PRIVATE/PUBLIC via share link).

**What shipped**: `Report` / `ReportRevision` / `ReportShareLink`
(append-only, revisions never edited in place); 5 collectors normalizing
each source's latest completed run (a missing source is omitted, never
fabricated — a project can generate with zero completed sources, never a
409); pure content-assembly functions (`worstFirstOrder` — ranks only
present sections by a per-section "how damning" score, ties broken by a
fixed default order; `computeDeltas` — MONTHLY only, diffs a bounded set
of already-computed numbers against the previous **RELEASED** report's
frozen snapshot, never a module missing from either side);
`ReportNarrativeService` (one LLM call, executive summary, "never state
an uncited number" discipline, falls back to a placeholder on failure
rather than blocking generation); Handlebars render pipeline (view-model
built in TypeScript, templates stay dumb/data-driven; obsidian/linen/
terracotta + Jost/Instrument-Sans/Fraunces design tokens ported from the
old repo's style guide, not its differently-themed HTML template).

**DAY1 bypasses the editorial gate entirely** — `generate()` creates it
straight into RELEASED with `releasedRevisionId` already set. **MONTHLY**
goes through the full state machine: `DRAFT → (review, re-collects+
re-renders fresh) → IN_REVIEW → (approve) → RELEASED`, with
`approve({approved:false})` returning to DRAFT. Both editorial-gate
endpoints 409 on a DAY1 report. Public read (`/reports/public/:token`,
no auth) and client-portal read (`/reports/:slug`, scoped to the
caller's own `clientId` from their JWT, unscoped for ADMIN) both return
raw HTML directly.

**Two gaps in the analysis doc's 3-table schema, filled by decision, both
noted in the module README**: `approve({approved:false, changesRequested})`
accepts and logs `changesRequested` but doesn't persist it (no column
for it); `withdraw()` has no explicit endpoint in the doc's API table
despite the `status` enum including `WITHDRAWN` — added as the
reasonable completion of the state machine.

**Bug caught while writing, not by a later test**: the client-portal
controller's first draft hardcoded `'*'` as the `clientId` passed to
`ReportingService.getBySlug()` — but that route has no `:clientId` URL
param, so a literal `'*'` would never match a real client and the
endpoint would always 404 for non-ADMIN callers. Fixed by deriving the
caller's own `clientId` from their JWT via `@CurrentUser()` (`null` for
ADMIN = unscoped) and threading it through the service, which now fetches
the report + correct revision directly instead of re-deriving ownership
through the shared `getOwned()` helper (that helper takes a required
`clientId`, wrong shape for this route).

**Live end-to-end run** against Fello (project `Fello`, `fello.ai`) — all
16 steps **PASS**, zero bugs found:
1. `generate('DAY1')` → RELEASED immediately, `sectionOrder: [aeoAudit,
   gapAnalysis, competitors]` (Technical Audit and Social Activity
   correctly omitted — no completed runs exist for this project right
   now, a real exercise of "missing source is omitted, never
   fabricated," not a mock). Real executive summary, citing only real
   numbers ("mentioned in 50% of 2 observations... cited in 50%... 0% of
   judged answers recommended it as the top pick... 1 competitor
   tracked").
2. `getOne()` on the released report → frozen snapshot, `releasedRevisionId` set.
3. `renderHtml()` → 10,983-byte standalone HTML page; spot-checked:
   correct worst-first `<h2>` ordering, numerals, badge classes, and the
   obsidian/linen/terracotta + Jost/Instrument-Sans/Fraunces tokens all
   present.
4. `list()` → 4 reports for the project (across this and a prior partial
   run of the same script).
5–6. Share link issued, public render returns the same HTML, revoke
   correctly 404s the token afterward ("Link not found or revoked").
7–9. `getBySlug()` scoping: the caller's own `clientId` resolves the
   report; a **different** client's id correctly 404s ("Report not
   found" — real cross-tenant isolation, not just a unit-test mock);
   `null` (ADMIN, unscoped) resolves it too.
10. `generate('MONTHLY')` (first one, no baseline) → DRAFT, real deltas
   against the DAY1 release (AEO mention/citation rate, 0.5 → 0.5 — no
   real movement between the two runs, correctly diffed as such rather
   than omitted).
11. `review()` on the DAY1 report correctly 409s ("DAY1 reports bypass
   the editorial gate").
12. `review()` on the MONTHLY draft → re-collects+re-renders fresh,
   IN_REVIEW.
13. `approve({approved:false})` → back to DRAFT, revision history kept.
14. `review()` again, then `approve({approved:true})` → RELEASED,
   `releasedRevisionId` set to the newest revision.
15. `withdraw()` → WITHDRAWN.
16. A fresh `generate('MONTHLY')` correctly picked the most recent
   RELEASED report (the DAY1 one, since the MONTHLY was withdrawn) as
   its delta baseline, and `sectionOrder` correctly led with `'deltas'`.

**Verified**: `tsc --noEmit` clean, `nest build` clean, `oxlint
--type-aware` 0 new warnings, backend 678 tests green (80 files, 34 new
in reporting — pure content-assembly functions, orchestrator with every
collaborator mocked, controller pass-through including a regression test
for the `getBySlug` scoping bug above).

**Known gaps**: no `docs/API.md` exists in this repo (never did — module
READMEs' "Public API" tables are the convention, matching every prior
module); `docs/features.md`'s per-module requirement tables stopped
being maintained after Technical Audit and weren't restarted here,
consistent with every module since Social Activity — not a Reporting-
specific omission. HTML render only, no PDF, per the analysis doc's
explicit scope for this pass.

## 2026-09-27 — Gap Analysis module (SOP-5): source consolidation, guardrails, API (DB, backend, tests, docs)

Built from the approved `docs/analysis/gap-analysis.md`. The first and
only place a recommendation gets generated in this pipeline — reads the
latest completed run from Technical Audit, Social Activity, and AEO
Audit via their own exported services (no cross-module DB reads), then
one LLM call consolidates every finding into a ranked list of concrete
next steps. No new taxonomy, no re-derived findings, no invented numbers
— a deliberate departure from the old repo's rules-engine classifier.

**What shipped**: three collectors flattening each source's latest
completed run into citable `(module, findingRef, summary)` rows,
`GapAnalysisGenerationService` (the one LLM call), deterministic
guardrails (rationale-grounding per citation against the collected data;
no-fabricated-numbers scoped to what each recommendation actually cites,
not the whole pool; 3–15 item count bound, rejected not auto-padded),
orchestrator (409 on zero completed sources, 409 on an out-of-range
guardrail-passed count, contiguous re-ranking after drops),
`GapAnalysisRecommendation.status` (OPEN/DONE/DISMISSED) as the one
mutable field on an otherwise append-only run.

**Noted in the module README**: Technical Audit's `AuditFinding.recommendedFix`
is genuinely populated per check, contrary to the analysis doc's stated
premise ("none of the three source modules currently emit a recommended
action"). Doesn't change scope — the module's value is the cross-source
merge + single ranked list, not whether one source already suggests
something in isolation.

**Live end-to-end run** against Fello: **COMPLETE**, 3 recommendations,
1 source available (AEO Audit only — Social Activity's and Technical
Audit's completed runs for Fello had been cleaned up by their own
earlier live-test scripts, a real exercise of the "missing source is not
an error" path, not a bug). All 3 recommendations correctly grounded —
every citation resolved to a real AEO Audit headline/competitor
reference, no fabricated numbers, contiguous ranks 1–3. One
recommendation correctly merged all 8 co-mentioned competitor names from
`competitorStanding` into a single "build comparison pages" action item
— the cross-source/cross-finding merge this module exists to do.

**Verified**: `tsc --noEmit` clean, `nest build` clean, `oxlint
--type-aware` 0 errors, backend 617 tests green (71 files, 31 new in
gap-analysis).

## 2026-09-27 — AEO Audit live end-to-end run against Fello + a real bug found and fixed

Ran the full pipeline against Fello's already-active 2-prompt query set:
one known competitor seeded ("Follow Up Boss"), an audit created
(`cloro_chatgpt`, US), `run()` executed. Result: **COMPLETE**, 2/2
observations, 2/2 stances judged, **$0.00457 real spend** (Cloro
measurement + 2 stance-judge LLM calls). One prompt scored `absent`
(named 7 rival products, none matching the tracked competitor by exact
string — all correctly queued as `candidate` rows), one scored
`recommended_alternative` with a real evidence quote. Verdict computed:
50% mention/citation rate, one funnel-stage breakdown, headlines correct,
narrative written by the shared LlmService.

**A real bug was caught by this run and fixed before it shipped**:
`buildCompetitorStanding()` tallied `coMentions` straight from each
stance's raw, unfiltered `brandsNamed` list — so the subject's own brand
("Fello") and a non-competitor platform ("G2") showed up in
`competitorStanding` with real co-mention counts, exactly the kind of
false-rival noise `otherNamesSeen`'s filter was supposed to prevent
everywhere. Root cause: the noise filter (self-brand + known-platform
exclusion) lived only inside `AeoStanceService`, never applied to the
raw `brandsNamed` list that verdict-building reads. Fixed by extracting
a shared `name-noise.ts` (`isNoiseName`) used by both — verdict-building
now filters `brandsNamed` through the same rule before tallying
`coMentions`, while still correctly counting a known, *tracked*
competitor's co-mentions (that name is deliberately not noise, unlike
the subject's own brand or "G2" — a naive "exclude known names too" fix
would have wrongly zeroed out real rivals like "Follow Up Boss", which
this run's own data confirmed should show `coMentions: 2`). Two
regression tests added: one for each direction of the bug.

Also confirmed correctly working live: the audit-wide cost cap
accounting, per-surface-run isolation infra (untested live since only
one surface ran), candidate-recording round-trip (7 new `candidate` rows
created from real stance output), and the comparability-gated narrative
path (no prior audit existed yet, so no trend claim was attempted —
correct behavior per `areAuditsComparable`).

## 2026-09-27 — AEO Audit module: stance judging, verdict, competitor tracking, API (DB, backend, tests, docs)

Built ahead of a written analysis doc, per explicit operator instruction,
same as Measurement. Ties an ACTIVE query set to one or more Measurement
runs (one per surface x market), judges each observation's stance (a
separate LLM call, distinct from Measurement's deterministic
mentioned/cited scoring), assembles a verdict, writes a best-effort
narrative. Never generates its own query set — closes the layering gap
Query Set's own design doc recorded.

**Ported from the old repo's `aeo-audit` module, scoped down**: kept
stance judging's classification/filtering logic, the comparability check
(near-verbatim), verdict's rate-slice/no-score design (confirmed: the
old module computed no composite score either — this repo doesn't invent
one), narrative's never-invent-a-number contract, an audit-wide cost cap
separate from Measurement's own per-run cap. Dropped as superseded: the
old matrix generator (Query Set's LLM-invented buckets replace it), the
old context service (Discovery's `CompanyContextProfile` replaces it),
visibility read-composition endpoints (no frontend yet), every
`*-browser` Playwright adapter + Cloro-browser fallback chain (Cloro-
only, matching Measurement's own scoping decision). Changed:
`Project.competitors` (seed JSON) + a separate untracked candidates
table → one `Competitor` table, fixing a real sync gap in the old design
where a confirmed candidate never fed back into future stance passes.

`MeasurementModule` now also exports `CloroClient` so both modules share
one instance — a second instance would run its own, uncoordinated
concurrency limiter.

**Verified**: `tsc --noEmit` clean, `nest build` clean, `oxlint
--type-aware` 0 errors, backend 586 tests green (64 files, 47 in
aeo-audit — including 2 regression tests for the competitor-standing bug
the live run caught). Live end-to-end run recorded in the entry above.

## 2026-09-27 — Live end-to-end: Discovery → Query Set generation → Cloro measurement, real chain against Fello

Ran the actual downstream chain against Fello (fello.ai), the one real
project in the DB, closing the open live-e2e items for both Discovery,
Query Set and Measurement in one pass.

**Discovery** (Fello had zero prior runs — likely created while Redis was
down): ran live, `MANUAL_REVIEW_REQUIRED` in 433s (25 services extracted,
overall confidence 0.769, completeness 0.95) — a real, usable
`CompanyContextProfile`, first one this repo has produced.

**Query Set generate()**: two attempts genuinely failed and were
correctly rejected by the bucket-count guardrail (15 buckets, then 20 —
both over the 4–14 max) before any generation budget was spent on them.
Root cause: the propose-buckets LLM prompt never told the model the
bound. Fixed (`PROPOSE_SYSTEM` now states the exact 4–14 bucket / 5–40
per-bucket limits) and verified against the full test suite before
retrying live. Third attempt: 14 buckets (in bounds), the tier-scaling
guardrail correctly fired on a genuinely over-budget proposal (250
prompts proposed vs the 60-prompt starter tier, scaled by 0.24), 74
items generated and persisted. This is the guardrail chain working
exactly as designed against real, non-deterministic model output — not a
fixture.

**Measurement live e2e**: a small manually-created 2-prompt query set
(kept separate from the full generated set to control real spend) was
activated and measured against `cloro_chatgpt`. Both observations
completed, **$0.004 total real Cloro spend**: one generic-industry prompt
correctly scored `mentioned: false, cited: false`, one branded prompt
correctly scored `mentioned: true, cited: true` — the mention/citation
extraction logic confirmed against real model output. Cloro account
balance checked beforehand (475 credits) to size the test safely.

Also fixed along the way: the live-run harness script needed
`GlobalJwtModule` (used by every controller's guards) and the
`configuration` loader (namespaces env vars for `GlobalJwtModule`'s own
`ConfigService.getOrThrow` calls) — both missing on the first two boot
attempts, same class of gap as the earlier Technical Audit live-run
script.

## 2026-09-27 — Measurement module (SOP-2): Cloro wiring, orchestrator, API (DB, backend, tests, docs)

Built per explicit operator instruction, ahead of a written analysis
doc — every other module in this repo went analysis-doc-first, this one
didn't. Ported from the old repo's `measurement` module: `CloroClient`
(multi-key fallback across separate cloro.dev accounts, FIFO concurrency
limiter, async submit→poll→COMPLETED lifecycle) + 5 surface adapters
(chatgpt/perplexity/gemini/ai-overview/ai-mode), `MeasurementService`
orchestrator (`createRun` only accepts an ACTIVE query set — immutability
is what makes the cohort comparable — cost-capped `executeRun` that stops
and marks failed when `MEASUREMENT_MAX_COST_PER_RUN` is crossed,
failed-run retry wipes stale observations, per-observation isolation),
pure `observation-scoring` (mention/citation extraction, no I/O).

**Known gap, documented in the module README**: no share-of-voice /
competitor detection — the old repo read `Project.competitors`, a column
that doesn't exist in this schema. `shareOfVoice` is always `[]`.

Also narrower surface scope than the old repo (Cloro only, no
claude/perplexity first-party or `*-browser` Playwright adapters — not
asked for), and `runCount` floor lowered to 1 (ported the old code's
actual behavior, not its stale "n>=5, no exceptions" README claim — the
code itself had already been changed on a prior explicit operator
override).

**Verified**: `tsc --noEmit` clean, `nest build` clean, `oxlint
--type-aware` 0 errors, backend 539 tests green (57 files, 30 new in
measurement — pure scoring, `CloroClient` against a mocked `fetch`,
orchestrator against mocked adapters + Prisma, controller pass-through).
Live end-to-end run recorded in the entry above.

## 2026-09-27 — Query Set module (SOP-1): two-step LLM generation, guardrails, API (DB, backend, tests, docs)

Built from the approved `docs/analysis/query-set.md`. Prompt generation
moves from AEO Audit into its own module (layering fix); buckets are no
longer a fixed enum — invented per project by an LLM call, grounded in
Discovery's `CompanyContextProfile`, and bounded by deterministic
guardrails enforced in code, not left to the model.

**What shipped**: `QuerySetGenerationService` (two LLM calls via the
shared `LlmModule` — propose buckets, then generate prompts per bucket;
malformed entries dropped, never guessed), pure guardrails
(`rejectUngroundedBuckets` — a rationale must cite a real
`CompanyContextProfile` term; `checkBucketCount` 4–14; `clampPerBucketCounts`
5–40; `scaleToTier` proportional, never drops a bucket; `checkUnbrandedFloor`
≥70%), `QuerySetService` (manual CRUD on drafts, `generate()` 409s without
a profile or on a rejecting guardrail rather than auto-fixing, per-bucket
generation failure never aborts the set, `activate()`/`fork()` immutability
lifecycle, export), nested controllers, module README, API reference,
status tables.

**Note**: tier target sizes (`starter: 60`, `full: 200`) aren't pinned in
the analysis doc — this build's own default, flagged for the coordinator
to confirm.

**Verified**: `tsc --noEmit` clean, `nest build` clean, `oxlint
--type-aware` 0 errors, backend 509 tests green (53 files, 38 new in
query-set — guardrails tested against synthetic proposals, generation
service against a mocked `LlmService`, orchestrator against a mocked
generation service + Prisma). **Open**: one live end-to-end run against a
real project with a real Discovery `CompanyContextProfile`.

## 2026-09-27 — Migration connectivity: switched DATABASE_URL to Supabase session pooler

`prisma migrate dev` started failing with DNS resolution errors on the
direct `db.<ref>.supabase.co:5432` hostname (confirmed not a local network
issue — public DNS servers couldn't resolve it either, and the Supabase
dashboard showed the project Healthy). Supabase's direct-connection
hostname increasingly resolves over IPv6 only. Fixed by switching
`DATABASE_URL` to the session pooler
(`aws-0-ap-southeast-1.pooler.supabase.com:5432`, same credentials,
project-scoped username) — session mode (not transaction/6543) because
`prisma migrate` needs the advisory locks transaction pooling doesn't
support.

## 2026-09-26 — Social Activity live end-to-end run: PASS vs Fello (fello.ai)

Run `80d72471` through the real queue + worker with operator-confirmed
Apify spend: **COMPLETE in 184s, $0.010 total** (ceiling untouched). All 4
default platforms returned shaped data — LinkedIn (9,915 followers,
sporadic), Instagram (8,078 followers, every-2-3-days, 30.2 avg
engagement), Facebook (3,982 followers, weekly), X (daily) — exercising
every pattern bucket. 20 posts persisted, narrative written
(`hasNarrative: true` — the audit run's cleanup race avoided by waiting
for the narrative save before deleting rows). Scheduler without
`spendOptIn` fired nothing (no phantom row). No-stack check passed. All
temp rows deleted (runs/posts/profiles: 0 remaining). Actor table now
treats the 7 default actors as live-confirmed; alternatives stay
UNVERIFIED.

## 2026-09-26 — Social Activity module: Apify pulls, cadence aggregates, API (DB, backend, tests, docs)

Stage 3 of the Day-1 pipeline, built from the approved
`docs/analysis/digital-presence-audit.md`. Consumes Discovery's verified
`social_profiles` (VERIFIED-only default, personal shapes excluded, handles
parsed from verified URLs — never re-discovered, never guessed).

**What was built**: `ApifyService` (async submit→poll→dataset lifecycle,
per-actor `buildInput`/`normalizeItem`, absent-fields→null), pure
aggregation (`postsInWindow`, mean/longest gap, days-since-last, pattern
buckets daily→dormant, honest nulls), `SocialActivityService` (dual spend
gates — key 503 + `confirmSpend: true` 400 — sequential pulls under a
per-run cost ceiling, per-platform isolation, previous-run chain, chunked
`social_posts` writes, post-persist narrative via shared `LlmService`),
BullMQ `social-activity` queue (concurrency 1) + `SocialActivityScheduler`
(`upsertJobScheduler` WEEKLY default/MONTHLY, schedules without
`spendOptIn` fire nothing — no row, no spend), staff controllers nested
under client/project, module README, API reference, status tables.

**Verified**: `nest build` clean, backend 471 tests green (35 new in
social-activity). **Open**: one live end-to-end run vs a real project with
operator-confirmed Apify spend (temp rows deleted afterward) — which also
confirms each actor's input/output shape before the actor table is treated
as verified. Note: no `APIFY_API_KEY` is configured yet, so pulls fail
closed until an operator adds one.

## 2026-09-26 — Technical Audit live end-to-end run: PASS vs resend.com

Run `c92870e5` through the real queue + worker: **COMPLETE in 262s,
composite score 86** — robots/cdn/sitemap/js-render/agent-readiness/page-
inventory pass, schema fail, CWV error (failed closed, run still completed).
982 sitemap entries walked from the 11-child index (shared primitive
verified full-tree, not sample), 50 pages persisted, no-stack check passed
(second `startRun` returned the same run), WEEKLY upsert + MANUAL_ONLY
removal verified in Redis. Narrative save missed only because the
script's own cleanup deleted the row mid-step (LLM call itself ran —
harness artifact, not product bug). All temp rows deleted (0 remaining).

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
