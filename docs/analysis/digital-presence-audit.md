# Digital Presence Audit (Social Activity) — Analysis

Status: **analysis for approval. No code until approved (repo rule).**

## Scope

Stage 3 of the Day-1 pipeline, alongside Technical Audit. Discovery
(Stage 1) finds + verifies social profiles; Technical Audit (Stage 2)
scores the site; this module audits **publishing activity** — is the
company posting, how regularly, what pattern. Backend-only by design like
Discovery and Technical Audit: no client UI until the Day-1 report module
exists. Findings stored as data for later analysis/insights — **auditing
only, not recommendations**. No composite score v1, no "you should post
more" copy — store rows, insights later.

Explicitly out of scope (same split the new repo's `presence.types.ts`
already encodes — "are you publishing?" vs "are you findable?" are
reported separately):

- **Listings / directories / reviews / marketplaces** (crunchbase, g2,
  trustpilot, yelp, app stores…). The old repo covered these via a
  separate DataForSEO Business-Data pull (`presence.dataforseo.service.ts`)
  and a directory-rating pass — different vendors, different questions
  ("are you findable?", "are you filled in?", "are you rated?"). A later
  module, not this one.
- **Founder / personal profiles.** The audit is about the company (see
  "Inputs" for the exclusion rule).
- **Publishing channels** (medium, substack, github). Same "are you
  publishing?" family and the natural v2 extension — same pull/aggregate
  shape, mostly RSS/APIs rather than Apify actors. Out of v1 to bound
  actor-spend surface; the schema below already fits them.

## Reference material

The old repo has a full, shipped implementation at
`/Users/madan/test/cailyx/backend/src/modules/digital-presence/`
(`presence.apify.service.ts` — actor table, spend gates, async
submit→poll→dataset loop; `presence.service.ts` `socialActivity()` at
~:602 plus `summarizeSocialActivity()` at ~:915; `presence.types.ts` —
three-state rule, platform taxonomy; `presence.signatures.ts` — URL
handle gates). Same rule as Discovery and Technical Audit: **port the
logic, never the DB schema** — adapt persistence to our
conventions (small table set, append-only runs, BullMQ from day one).

**Confirmed portable close to as-is:** the Apify REST lifecycle
(submit → poll → dataset items; the 300s sync variant is documented
too-short and never used), `buildInput`/`normalizeItem` one-function-per-
actor structure with absent-fields→null, the `summarizeSocialActivity`
aggregation math, the `confirmSpend` + `APIFY_API_KEY` dual spend gates.

**NOT portable as-is:** anything touching the old Prisma models
(`presenceAccount` / `PresencePost` / `PresenceProfile` / `PresenceReview`
with their own state machine) — persistence is rewritten against the
schema below. The old per-actor input/output schemas were explicitly
**unverified** (old D7: "confirms each against one live run before
building on it" — a run that never happened there). Ours inherit that
status: every actor below ships as best-effort-from-Store-docs until an
operator-authorised live run confirms it (hard requirement 2).

## Inputs: consume Discovery's verified profiles, never re-discover

The pull targets come from one query, no fresh guessing:

- `social_profiles` where `projectId` matches, `verificationStatus =
  'VERIFIED'`, platform in the social group (`linkedin`, `instagram`,
  `facebook`, `x`, `youtube`, `tiktok`), **excluding personal shapes**:
  `scholar`/`orcid` never qualify (personal group), and LinkedIn
  `/in/` (person) URLs are excluded while `/company|school|showcase/`
  URLs qualify. Discovery's `social_profiles` rows do **not** persist an
  entity column, so the company-vs-person split is re-derived from
  platform group + URL shape at pull time via the existing signature
  matchers — parsing a handle/URL we already verified is consuming, not
  re-discovering.
- `PROBABLE` rows are **excluded by default**: scraping the wrong
  company's posts is a data-integrity failure, not a gap (same reasoning
  as the old `confirmed`-only identity gate). A per-project config flag
  (`includeProbable`) may opt in — recorded on the run row when used, so
  a later reader knows the sample is softer.
- No handle is ever fresh-guessed: Apify targets carry the verified
  `url`, with the handle parsed from it (platform handle regexes already
  live in `presence.signatures.ts`). A row with neither parseable handle
  nor URL is skipped with reason, never fabricated.

## Platform / actor table (v1 defaults + alternatives)

v1 default set mirrors the old D7 table: `linkedin`, `instagram`,
`facebook`, `x`. YouTube/TikTok actors are specified but **off unless
requested/configured** (same posture as D7).

| Platform | Role | Default actor (old-repo proven) | Alternatives (UNVERIFIED — confirm via live run) |
|---|---|---|---|
| linkedin | profile | `harvestapi/linkedin-company` | `apimaestro/linkedin-company-scraper` |
| linkedin | posts | `harvestapi/linkedin-company-posts` ($2/1k) | `apimaestro/linkedin-company-posts` |
| instagram | profile | `apify/instagram-profile-scraper` | `apidojo/instagram-scraper` |
| instagram | posts | `apify/instagram-post-scraper` | `apidojo/instagram-post-scraper` |
| facebook | profile | `apify/facebook-pages-scraper` | `apidojo/facebook-scraper` |
| facebook | posts | `apify/facebook-posts-scraper` | `apidojo/facebook-posts-scraper` |
| x | posts | `xquik/x-tweet-scraper` | `apidojo/tweet-scraper`, `quacker/twitter-scraper` |
| youtube | profile | `streamers/youtube-channel-scraper` | `apify/youtube-scraper` |
| tiktok | profile | `clockworks/tiktok-profile-scraper` | `clockworks/tiktok-scraper`, `apify/tiktok-scraper` |

Notes carried forward from the old module's scars:

- `linkedin:posts` must be the **company** actor, not the person-profile
  sibling (`harvestapi/linkedin-profile-posts` takes `profileUrls` for a
  PERSON and silently returns zero posts against a company page — no
  error, just nothing). Same class of trap as the old
  `twitterHandles`-vs-`handles` field-name bug on the x actor: a wrong
  field name runs clean and returns zero. Per-actor `buildInput` stays
  one small function so a confirming live run corrects exactly one place.
- x has **posts only** — no profile actor was selected. Follower counts
  for x are whatever the tweet payloads carry, else null (honest nulls).
- The old `within_time: '30d'` on the x input matches our window
  semantics (current cadence, not archive history) — keep it, and apply
  the 30-day filter at aggregation for every platform regardless of what
  the actor returned.

## Spend gates + cost ceiling (both, always)

Ported from the old adapter (`presence.apify.service.ts:9-24`), same
shape as the discovery `SWARM_ALLOW_LIVE` / DataForSEO gates:

1. `APIFY_API_KEY` configured — fail closed with typed 503 before any
   network touch, same convention as the PSI-missing path in Technical
   Audit (a check that can't run is `not-run`/`error`, never a guess).
2. Explicit `confirmSpend: true` in the trigger body — checked in the
   orchestrator **before** the adapter is touched. Scheduled/automatic
   runs must never spend without opt-in: the scheduler path carries the
   project's stored opt-in (see "Per-client config"), and a schedule
   without it fires nothing (run row is never created, not created-then-
   skipped — no phantom rows).
3. Per-run cost ceiling `SOCIAL_MAX_COST_PER_RUN_USD` (default 5.00,
   same as Technical Audit): platforms run sequentially in config order
   and the run stops pulling new platforms once spend crosses the
   ceiling — already-pulled platforms keep their rows, unpulled ones are
   recorded `not-run` with reason `cost-ceiling`, and the run still
   completes. Cost per platform prefers the actor run's own
   `usageTotalUsd`, falling back to the unit-cost table × items (estimate
   only, never presented as billed).

## Pull orchestration: async lifecycle only

`POST /v2/actors/{owner~name}/runs` → poll `GET /v2/actor-runs/{id}`
every 5s to `SUCCEEDED` (10-min per-actor timeout) → `GET
/v2/datasets/{id}/items`. Per-platform isolation exactly like Technical
Audit's per-check isolation: one actor's throw becomes an `error` result
for that platform:role, never aborts the run. `postsPerPlatform`
defaults to `APIFY_POSTS_PER_PLATFORM` (20 — the old cost table is
priced against it) and is recorded per run so later math knows the
sample depth.

## Normalization: guess-tolerant boundary

One `normalizeItem` per actor family at the adapter boundary: several
candidate field names per metric, absent → `null`, never fabricated. The
old candidate lists (likes/likeCount/favoriteCount/diggCount,
timestamps as ISO/epoch-seconds/epoch-millis/nested `{timestamp, date}`,
etc.) port verbatim; new actors extend the lists, never the shape. Every
row keeps `actorId` + full `raw` JSON for later re-normalization without
re-spend.

## Aggregation: pure functions over stored rows (extends the old summary)

`summarizeSocialActivity` ports as-is (group by platform; followerCount
from the profile row; `postsSampled`; `lastPostAt` newest-first;
`avgEngagement = mean(likes+comments+shares)`, nulls→0, views ignored).
**New in v1** — computed over posts in the 30-day window (`postedAt >=
now - 30d`; null-`postedAt` rows excluded from window math and counted
separately as `undated`), per platform:

- `postsInWindow`, `meanIntervalDays` (mean gap between consecutive
  in-window posts, null when < 2 dated posts), `longestGapDays`,
  `daysSinceLastPost`.
- `pattern` bucket (thresholds — open for approval tuning):
  `daily` (mean ≤ 1.5d), `every-2-3-days` (≤ 3.5d), `weekly` (≤ 8d),
  `sporadic` (≥ 2 posts but slower, or single post in window),
  `dormant` (0 in-window posts, or last post > 45d ago regardless of
  mean). Buckets derive from the pulled **sample** (≤ 20 posts): for
  high-volume accounts the sample covers days, not the window — mean
  interval stays valid, longest gap is a lower bound, and the row says
  so (`windowTruncated: true` when pulled == requested limit).
- `avgEngagement` + `followers` (honest nulls; refused reads =
  `unverified`, never `missing` — the three-state rule: a login-walled
  profile is routine, not a failure).

Findings v1 (audit, not advice): `dormant` → finding; `sporadic` with
`daysSinceLastPost > 14` → finding; platform with zero dated posts but
undated rows → `unverified` (data-quality flag, not a cadence claim).
No score, no recommendations.

## Deltas: where cheap

Run-over-run on the stored aggregates only: follower delta, posts-count
delta, pattern-bucket transitions (`active → dormant` and reverse),
`daysSinceLastPost` movement. Previous run resolved before persist
(same chain discipline as Technical Audit); first scored run has null
previous. No page-level churn — aggregates only.

## Narrative: same shared client, same discipline

Via the shared `LlmService` (no second client — the whole point of the
extraction commit), after persistence, never throws, never touches
numbers. Four-section ceiling like the audit narrative: what changed,
what's dormant, data-quality notes, what to verify live. Best-effort by
contract.

## Job orchestration: mirrors Technical Audit

One BullMQ queue (`social-activity`, concurrency 1 — actor spend and
rate limits compound across projects), one job per run row, terminal
rows no-op on retry. Never two runs per project concurrently
(`startRun` returns the active row — a concurrent run would corrupt the
previous-run chain). Sequential platform pulls inside one job (cost
ceiling needs ordering); no multi-stage pause/resume machinery — bounded
HTTP/poll calls complete inside the job, same reasoning as the audit
module.

## DB schema (3 tables, same conventions)

Append-only runs, no `deleted_at` (a schedule off is `active: false`;
a run is never edited after completion) — same reasoning as Discovery's
and Technical Audit's tables:

- `social_activity_runs`: `projectId`, `status` (QUEUED/RUNNING/
  COMPLETE/FAILED), `triggeredBy` (MANUAL/SCHEDULED),
  `previousRunId` (nullable, resolved pre-create), `platforms`
  (string[] as-run), `postsPerPlatform`, `windowDays`,
  `includeProbable` (bool, default false), `totalCostUsd`,
  `result` (per-platform aggregates JSON), `findings` (JSON),
  `deltas` (JSON, computed once), `narrative` + `narrativeModel`,
  timestamps.
- `social_posts`: `socialActivityRunId`, `projectId` (denormalized,
  same pattern as `audit_pages`), `platform`, `kind`
  (profile/post), `postedAt` (nullable), `url`, `caption`,
  like/comment/share/view/follower/following/post counts (all
  nullable), `actorId`, `raw` (full item JSON for re-normalization).
- `social_activity_schedules`: `projectId` unique, `cadence`
  (WEEKLY/MONTHLY/MANUAL_ONLY), `active`, **plus the module-owned
  config payload**: `platforms` (nullable string[] — null means
  defaults), `windowDays`, `postsPerPlatform`, `spendOptIn` (bool —
  scheduler fires nothing unless true). This row *is* the per-client
  config (plugin principle — no boolean-placeholder table).

## Scheduling: WEEKLY default + manual trigger

`upsertJobScheduler` with `every` intervals (WEEKLY default at schedule
creation, MONTHLY available, MANUAL_ONLY removes) — same mechanics and
same honesty note as Technical Audit: the design never depends on
whether `every` measures from completion (no concurrent runs per
project by construction; a late fire skips when a run is active).

## Controllers: nested under client/project, same guards

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/team/clients/:clientId/projects/:projectId/social-activity-runs` | ADMIN | body `{ confirmSpend: true, platforms?, postsPerPlatform?, windowDays?, includeProbable? }` — 400 without the opt-in; returns active run when one is QUEUED/RUNNING |
| GET | `/team/clients/:clientId/projects/:projectId/social-activity-runs` | `view_projects` | history, newest first |
| GET | `/team/clients/:clientId/social-activity-runs/:runId` | `view_projects` | one run + per-platform aggregates |
| GET | `/team/clients/:clientId/social-activity-runs/:runId/comparison` | `view_projects` | deltas vs previous |
| PUT/GET | `…/projects/:projectId/social-activity-schedule` | ADMIN / `view_projects` | `{ cadence, platforms?, windowDays?, postsPerPlatform?, spendOptIn }` |

No new permission; existing `view_projects` scopes reads, ADMIN gates
triggers and spend. `APIFY_API_KEY` unset → typed 503 fail-closed.

## Env

`APIFY_API_KEY` (required to pull; absent = 503), `APIFY_PLATFORMS`
(csv override, default the v1 four), `APIFY_POSTS_PER_PLATFORM`
(default 20), `APIFY_ACTORS` (JSON actor-map override, same escape
hatch as the old module), `SOCIAL_WINDOW_DAYS` (default 30),
`SOCIAL_MAX_COST_PER_RUN_USD` (default 5.00). All validated in
`validation.schema.ts`, documented in `.env.example`.

## Decisions confirmed before code

- Input = VERIFIED-only social-group company profiles; PROBABLE behind
  `includeProbable`, recorded per run.
- Pattern buckets + thresholds as above (tuning welcome in review).
- Caption + raw stored per post (re-normalization without re-spend).
- v1 platforms: linkedin/instagram/facebook/x; youtube/tiktok specified,
  off by default.
- Every actor alternative in the table is UNVERIFIED until one
  operator-authorised live run confirms its input/output shape.

## Testing plan

Same rigor as the audit module: unit tests per actor
`buildInput`/`normalizeItem` (fixture items, absent-fields→null cases),
aggregation pure-function cases (boundary means/gaps, undated rows,
truncated windows), spend-gate tests (no key → 503, no opt-in → 400,
scheduler without opt-in fires nothing), orchestrator isolation/chain
decisions with mocked adapter, controller scope pass-through,
scheduler interval-vs-manual branching. Then **one live run vs a real
project with operator-confirmed spend** (confirm each actor against the
run before building on its shape), temp rows deleted afterward, plus
confirming the scheduler's no-stack behavior across one real re-cycle.
`docs/features.md` + module README updated on completion.
