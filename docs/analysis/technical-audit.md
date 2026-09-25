# Technical Audit Module — Analysis

Status: **built (backend + staff UI). Live end-to-end run still open — see "Testing plan".**

## Scope

Given a `Project`, crawl its site and run a fixed set of technical/SEO
checks: robots.txt analysis, CDN/bot-block probing, JS-render dependency
detection, Core Web Vitals (PageSpeed Insights), schema.org/structured-data
analysis, sitemap analysis, agent-readiness (AI-crawler accessibility),
per-page SEO issues (titles, meta, headings, canonicals, duplicate content,
images/alt, URL structure), a composite score, run-over-run deltas against
the project's previous audit, and weekly/monthly scheduling.

Explicitly out of scope, same reasoning as Discovery: anything needing
GSC/GA4 (not available at this point in the flow — the client hasn't
onboarded that access). Also out of scope for *this* module specifically:
"Technology & Marketing Stack" detection (analytics/CRM/chat-tool
fingerprinting) — a separate concern, lives in the old repo's `tech-stack/`
module, small enough to fold into a later pass. Not ported here.

## Reference material

The old repo has a full, shipped implementation at
`/Users/madan/test/cailyx/backend/src/modules/technical-audit/`
(`technical-audit.types.ts`, `technical-audit.service.ts` — the 1358-line
orchestrator, `technical-audit.deltas.ts`, `audit-scheduler.service.ts`,
`checks/{sitemap,page-inventory,seo-rubric,page-signals,agent-readiness,
audit-narrative}.ts`), plus `fetcher/adapters/psi.adapter.ts`. Same rule as
Discovery: reuse the logic, never the DB schema, adapt persistence to our
4-migration/3-table conventions.

**Confirmed Prisma-free (portable close to as-is):** `technical-audit.deltas.ts`
(pure functions, no I/O — confirmed by direct read), all four `checks/`
files except the orchestrator's own DB calls, `psi.adapter.ts` (confirmed
DB-free, only dependency is `axios`).

**NOT portable as-is:** `technical-audit.service.ts` — direct
`prisma.technicalAudit.create/update/findFirst` and
`prisma.auditPage.createMany` calls are interleaved with orchestration
logic, not isolated behind a repository layer. Persistence is rewritten
against our 3-table schema (below); the orchestration *sequence* and
per-check failure isolation are ported as designed.

**Not ported as designed, rebuilt on our infrastructure:**
- `audit-scheduler.service.ts` — an in-process `@nestjs/schedule` cron,
  explicitly built because that deployment had no Redis. We have BullMQ
  from Discovery; this becomes `upsertJobScheduler()`. See "Scheduling"
  below — the old code's exact semantics (measure next-run from completion
  time, not from a missed slot; never two audits for the same project
  concurrently; audits run one at a time site-wide to protect the cost
  ceiling) don't fall out of a naive cron-pattern scheduler for free and
  need deliberate replication.
- `checks/audit-narrative.service.ts` — the prompt-building logic
  (`buildPrompt`, `keyFacts`, the four-section system prompt) is reused
  verbatim; the HTTP plumbing is not. The old file hand-rolls its own raw
  `fetch()` call to OpenRouter instead of using this same codebase's shared
  LLM client (its own comment notes a shared client already existed
  elsewhere and it just didn't use it) — ours calls through the `LlmService`
  already ported for Discovery, no second LLM client.

## Pipeline: sequential checks, graceful degradation

Eight checks run **strictly sequentially** (not `Promise.all`) — cheap
access checks before expensive crawl, ported in this order:

```
robots → cdn-inferred → sitemap → js-render → cwv → schema
       → agent-readiness → page-inventory
```

`page-inventory` only runs if `sitemap.entries.length > 0`; with no sitemap
it's skipped with a `not-run` finding, not routed through error handling.
Internal concurrency exists only inside two checks: CDN probing (5
concurrent bot probes) and schema's `sameAs` verification (up to 10
concurrent). `page-inventory` itself batches at `concurrency = 6`
(`technicalAudit.pageCrawlConcurrency`, portable as an env default).

**Per-check isolation** (ported verbatim — this is the graceful-degradation
contract): every check is wrapped so a thrown error becomes an `error`-status
finding, never aborts the run:

```ts
const run = async (label, fn) => {
  try { findings.push(await fn()); }
  catch (err) { findings.push(this.errorFinding(label, err.message)); }
};
```

After checks: page metadata capture (title/meta/headings/positioning copy)
is a best-effort extra pass, non-fatal on failure.

## Composite score

Weighted average over six components (weights sum to 100, ported verbatim):
`access: 25` (avg of CDN-probe pass rate and robots-check pass/fail),
`rendering: 15` (`100 - contentLossPercent` from js-render), `structured: 20`
(avg of schema-presence pass/fail and site-wide JSON-LD coverage %),
`content: 15` (page-inventory's `averageScore` directly), `performance: 15`
(PSI's Lighthouse performance category), `agent: 10` (is-agentic score).

**Missing components are dropped and the remaining weights renormalized** —
e.g. no PSI key means `performance`'s 15 is excluded and the rest scale to
sum to 100 over what ran. Returns `null` if nothing ran at all. The old
code's own comment calls this a deliberate exception to a "never
renormalize" rule used elsewhere in that codebase — ported as designed,
noted here so it isn't mistaken for an oversight later.

## Deltas: pure, already portable

`technical-audit.deltas.ts` is genuinely Prisma-free (confirmed) and ports
close to verbatim. Its shape:

```ts
interface ComparableRun {
  id: string; createdAt: string; score: number | null;
  findings: Array<Pick<AuditFinding, 'type'|'status'|'severity'> & { detail: unknown }>;
  pages: Array<Pick<AuditPageResult, 'url'|'score'|'issues'>>;
}
computeDeltas(current: ComparableRun, previous: ComparableRun | null): AuditDelta[]
comparePages(current, previous): AuditComparison['pageChanges']
buildComparison(current, previous): AuditComparison
```

16-metric registry (`key`/`label`/`higherIsBetter`/source), ported exactly:
`composite`, `openFailures`, `agentReadiness`, `lighthousePerformance`,
`lighthouseSeo`, `lighthouseAccessibility`, `lcp`, `cls`, `inp`,
`sitemapUrls`, `sitemapStaleDays`, `pageAverageScore`, `pagesWithoutJsonLd`,
`pagesBadTitle`, `pagesBadMeta`, `blockedBots`.

Direction rule (ported exactly): no current value → `unchanged` (absence
isn't "newly measured"); current but no previous → `new`; equal →
`unchanged`; otherwise `improved` iff the rise direction matches the
metric's static `higherIsBetter`, else `regressed`. A metric with both
values null is dropped from the output entirely, not reported as an empty
row.

**Previous-run resolution**: query the project's most recent audit with
`score IS NOT NULL`, **before** persisting the current run — a failed/partial
prior run (no score) never becomes the diff baseline, which would report
every metric as spuriously "new." Ported as designed.

## SEO rubric — every threshold ported verbatim, not rounded

These are tuned numbers, not round guesses (the old file's own comments cite
Backlinko/Moz sourcing for some). Bands:

```
titleMin: 30       titleMax: 60
metaMin: 70         metaMax: 160
minWords: 150 (thin-content floor)
maxMissingAltRatio: 0.25
urlMaxLength: 115
urlMaxParams: 3
```

Deduction weights (score = `100 − Σdeductions`, clamped ≥ 0; not
additive-safe to 100 by design, checks can overlap):

```
page-error: 100          noindex: 100
json-ld-missing: 20      title-missing: 20     canonical-cross-domain: 18
meta-missing: 15         h1-missing: 12        canonical-malformed: 10
json-ld-invalid: 10      thin-content: 10      duplicate-content: 10
images-missing-alt: 8    title-too-long: 8     title-too-short: 8
canonical-missing: 8     heading-level-skipped: 6   meta-too-long: 6
meta-too-short: 6        h1-multiple: 6         url-excess-params: 5
url-too-long: 4          url-has-uppercase: 4    url-has-underscore: 3
```

Rule branching order matters (issue-array order is relied on for run-to-run
comparability) — ported exactly:
1. `status === 0 || status >= 400` → `['page-error']` only, nothing else evaluated.
2. `noindex` → pushed, does **not** short-circuit further checks (unlike page-error).
3. Title/meta: missing → `-missing`; else too-short/too-long against the bands (mutually exclusive else-if chain).
4. H1: `0` → `h1-missing`; `>1` → `h1-multiple`.
5. Heading hierarchy: a level jump past the deepest level introduced so far → `heading-level-skipped` (one flag total, not per skip).
6. Canonical: missing/blank → `canonical-missing`; unparseable or non-http(s) → `canonical-malformed`; hostname (www.-stripped) differs from the site's → `canonical-cross-domain`. Same-domain-different-path is explicitly not flagged (pagination/faceted nav is legitimate).
7. URL structure — **not mutually exclusive, can stack**: length, uppercase, underscore, excess params each independently checked.
8. JSON-LD: `0` → `json-ld-missing`; else invalid → `json-ld-invalid`.
9. Word count `< 150` → `thin-content`.
10. Alt coverage — only evaluated when the page has images with any missing alt: ratio `> 0.25` **or** every image on the page missing alt (trips regardless of ratio for a small image count).

**Duplicate content** is a two-pass design: `contentHash` is computed
per-page during the crawl loop (same djb2 fingerprint algorithm Discovery's
`pipeline-utils.ts` already uses — confirmed byte-for-byte identical: seed
5381, ×33, 4000-char normalized cap, `hash:length` format — extracted into
the shared module below rather than duplicated a third time), then AFTER the
full crawl completes, pages sharing a hash with ≥1 other page are flagged
and **re-scored** — the deduction only lands on this second pass. Preserved
as a two-pass design in the port, not collapsed into one pass.

**Page-signal extraction** (`page-signals.ts`, cheerio-based): title (`head
title`, falls back to bare `title`), meta description (`meta[name=
"description"]`, falls back to `og:description`), canonical
(`link[rel="canonical"]`), noindex (`meta[name="robots"]` contains
"noindex"), heading levels (document-order `h1`–`h6` → `number[]`, level-skip
detection lives in the rubric, not here), word count (body text minus
`script/style/noscript/template/svg`), images (a "decorative" image —
`alt=""`, `aria-hidden`, `role="presentation"`, or 1×1 — is excluded from
counts entirely; `alt` attribute wholly *absent* counts as missing, `alt=""`
does not), JSON-LD (parse + `@type` walk through `@graph`/`mainEntity`/
`itemListElement`/`hasPart`, depth-capped at 6).

## Page inventory: takes a URL list, doesn't discover its own

`page-inventory.check.ts` takes `entries: SitemapEntry[]` as input — sitemap
discovery is a separate upstream step (the sitemap check, below). It
dedupes by URL, sorts newest-`lastmod`-first (no-lastmod entries sort last),
slices to the crawl budget (`technicalAudit.pageCrawlBudget`, default 150),
filters through `RobotsService.filterAllowed()` (fails open if robots.txt is
unreadable), then crawls in batches of 6.

## Sitemap check — the piece that overlaps Discovery's shipped code

**This is a genuine gap in the shipped, committed Discovery code**, not just
an opportunity to share logic. Discovery's `sitemapCandidates` (now
`discover.stage.ts`) stops reading robots.txt's declared sitemaps at the
first entry point that yields anything:

```ts
for (const entry of sitemapEntryPoints) {
  if (!budgetLeft()) break;
  top.push(...(await readSitemap(entry)));
  if (top.length > 0) break; // ← stops here
}
```

Fine for Discovery, which only needs ~12–20 representative pages and narrows
further downstream anyway. **Wrong for Technical Audit's full-coverage
needs**: a site can legitimately declare `Sitemap: /sitemap-pages.xml` AND
`Sitemap: /sitemap-blog.xml` as two separate lines, and this logic would
silently never read the second one — a real gap in what's already shipped,
not a hypothetical.

**Proposed fix, flagged for confirmation before touching committed code**
(see "Open questions" below): extract a shared "discover the sitemap tree"
primitive — read `robots.txt` `Sitemap:` directives, fall back to
conventional paths only when robots.txt names none, read from **every**
declared entry point (not just the first that resolves), walk sitemap-index
nesting to a bounded depth (index-walk logic is already correct, confirmed
by both old-repo and Discovery's tree-walk — no fix needed there, just
confirm it survives the extraction), all still bounded by the run's request
budget. Returns the flat, deduped `SitemapEntry[]` (url + lastmod) plus which
entry points were tried/resolved.

Split of responsibility after extraction:
- **Discovery** keeps its own downstream shaping unchanged (same-origin
  filter, per-path-template sampling, high-signal-keyword sort, cap at 20) —
  it only gets a more complete raw URL set to shape from.
- **Technical Audit**'s sitemap check builds the richer `SitemapAnalysis`
  (staleness, duplicate/off-origin counts, index/child-sitemap detection)
  from the same shared discovery, now merged across every entry point that
  resolved rather than just the first.

**Type-shape consequence, flagged**: `SitemapAnalysis.sitemapUrl: string` is
singular in the old type, built around "the one sitemap we found." Reading
every declared entry point means there can genuinely be several root
sitemaps. Proposed: keep `sitemapUrl` as the first entry point that
resolved (for simple display), add `sitemapUrls: string[]` carrying every
one that did. Not silently redefining the existing field's meaning.

Placement: a new small shared module near `fetcher/` (crawl infrastructure
both modules need), not inside either module's own directory. Discovery's
`discover.stage.ts` and `pipeline-utils.ts` are updated to call it instead
of the private method they have today; **Discovery's existing test suite
(`discover.stage.spec.ts`, `pipeline-utils.spec.ts`) must still pass
unchanged after the refactor** — this is a behavior-preserving extraction
for Discovery's own logic, made more complete only for the case (multiple
declared sitemaps) its tests don't currently exercise.

## Agent readiness: CLI-first, careful subprocess handling — one real doc/code mismatch

Invokes `npx --yes is-agentic@latest <host> --json` via `execFile` (never
`exec`), array args, `shell: false`, host pre-validated against a strict
hostname-only regex before it ever reaches a subprocess — genuinely careful
injection defense, not a naive `exec()` call. Falls back to a read-only API
call (`is-agentic.com/api/v1/report`) if the CLI path is disabled or fails.
Ported as designed, including the Windows `.cmd`-spawn workaround.

**Flagged and decided**: the old module's own comment claims the check is
"off by default for any host that is not the project's own domain," because
`is-agentic` **publishes scan reports publicly** at
`is-agentic.com/scan/<domain>` — inherent to the tool, not something this
module can opt out of. Reading the actual code: **no such ownership gate
exists** — only the syntactic hostname-shape check. This looks like a
doc/code mismatch in the shipped reference, not a deliberate design.
Decision (confirmed with the user): run it by default, matching the shipped
reference's actual code rather than its stale comment — every audited
domain gets a public is-agentic.com report page, same as the old repo's
real behavior as-shipped.

Also worth knowing: `npx is-agentic@latest` — no version pin, fetches from
the npm registry on every single call (network + registry-trust dependency,
non-deterministic across runs since "latest" can change under you). Ported
as-is per the brief; flagging so it's a known trade-off, not a surprise
later.

## Robots check — reuses the already-correct parser instead of porting a known bug

The shipped reference's `analyzeRobotsTxt` has two real defects, found while
extracting its exact logic: its Allow/Disallow precedence is exact-string
match, not the longest-match precedence its own docstring claims (so
`Allow: /blog/post` would not cancel `Disallow: /blog/` — only an exact
`Allow: /blog/` would); and it treats an empty `Disallow:` value as "block
everything," the opposite of the spec (an empty value restricts nothing).

This module does not port either bug. Discovery's already-shipped
`fetcher/services/robots.service.ts` (`RobotsService`) is a genuinely correct
parser — proper longest-match precedence with Allow winning ties, and an
empty pattern explicitly matching nothing (`// an empty Disallow/Allow value
matches nothing`) — used by every crawler in this codebase, just with zero
consumers yet in the new repo. Rather than write a second parser, this check
sources each bot's allow/disallow verdict from `RobotsService.isAllowed()`,
and exports `parseRobotsTxt`/`selectGroup` from that same service so the
check's display-only `paths` list comes from the identical parse. One
correct implementation, not two that could quietly disagree.

## PSI adapter

`fetchPsi(url)` → PageSpeed Insights v5, `strategy: mobile`, requesting all
four categories explicitly (`performance,seo,accessibility,best-practices`)
in one call — PSI only returns `performance` unless you ask for the rest,
and asking costs the same one Lighthouse run. Returns LCP/CLS/INP (`-1`
sentinel for "not measured"), per-category scores, every failed audit
(worst-first), CrUX field data (`null` is normal — origin below Google's
reporting threshold, not an error), `finalUrl`, `lighthouseVersion`. No
retry logic in the adapter itself; 60s timeout; confirmed DB-free.

**Normalized**: the old adapter reads `PSI_API_KEY` directly from
`process.env`, bypassing `ConfigService` — inconsistent with this repo's
`validation.schema.ts`/`configuration.ts` pattern used everywhere else
(including Discovery's own new env vars). Read through `ConfigService` here,
same as everything else.

## Narrative: same LLM client as Discovery, prompt logic reused

`AuditNarrativeService.write(input)` never throws — returns `null` on
disabled/no-key/non-OK/empty-response/any exception, each logged. Called
**after** persistence, wrapped in its own try/catch, so a narrative failure
never touches the score or findings that are already saved. The four-section
system prompt (`## Verdict`, `## What changed`, `## What matters now`,
`## Watch next run`, <350 words, quantitative, never invents unmeasured
numbers) and the `establishedFacts` guardrail-statement builder
(`keyFacts()` — plain-English facts about staleness/CWV sentinels/
agent-readiness gaps, designed specifically to stop the model misreading a
derived number) are reused verbatim. The raw OpenRouter `fetch()` plumbing
is replaced with a call through the already-ported `LlmService.json(...)`.
Rolling-memory mechanism (the prior run's own narrative text, fed back
labelled as "unverified prose to re-check, not fact") is preserved.

## Reusing Discovery's fetched pages — narrower than it first sounds

**Genuinely reusable** from a fresh `discovered_pages` row for the same
project + URL: `title`/`description` (Discovery's inspect stage extracts
these with the same precedence rules as `page-signals.ts` — meta description
falling back to `og:description`, `<title>` fallback — so title/meta
length-band checks transfer directly), JSON-LD entities + `jsonLdRaw`
(`jsonLdCount`/`jsonLdTypes`/`jsonLdValid` transfer), and `cleanedText` for
word-count/thin-content and the duplicate-content fingerprint (once the
fingerprint function is the single shared one).

**NOT reusable, and this matters**: Discovery persists no raw HTML by
design (`docs/analysis/discovery.md`, "What we persist per page"). Canonical
URL, per-image `alt`-attribute presence, and heading *levels* (Discovery
stores heading *text* only, no `h1`/`h2`/… level) all require reading actual
markup that Discovery never keeps. A page reused "fully" from Discovery
would silently read as `canonical: null`, no `h1Count`, no image data — which
the rubric would then score as `canonical-missing`/etc., a **false finding**,
not a saved fetch.

**Proposed scope**: page-inventory always does its own light `fetcher.fetch()`
of the raw HTML for canonical/headings-with-levels/images, regardless of
whether Discovery already visited the URL — that data genuinely doesn't
exist anywhere else. What "reuse" actually buys: (a) pre-filling
title/meta/JSON-LD/word-count from the stored row when present, so the
rubric never needs to re-derive them from the fresh fetch even though the
fresh fetch is happening anyway for the other signals, and more importantly
(b) for a URL Discovery already rendered with a headless browser (JS-heavy
pages), Technical Audit can use a plain HTTP `fetcher.fetch()` instead of a
full `fetcher.render()` for its own pass, since Discovery's successful
render is itself evidence the page doesn't need JS execution to be crawled
usefully for what's left to check — **except** when the js-render check (run
earlier in the same audit) has already determined the site is JS-dependent,
in which case a plain fetch's raw HTML won't carry the client-rendered
canonical/image tags either, and the render is unavoidable regardless of
Discovery overlap. Flagged — this is a smaller, more honest saving than "skip
the fetch," and I'd rather state the real shape of it than imply a bigger
win than the data supports.

## Job orchestration: one BullMQ job per run, no multi-stage pause/resume

Unlike Discovery's pipeline (LLM-heavy, iterative batching against page
text, genuinely can run long enough to need budget-based pause/resume across
multiple jobs), Technical Audit's eight checks are bounded HTTP/browser
calls the old orchestrator already runs to completion inside one method
call — a real run's total time is the sum of a handful of network round
trips plus a ~150-page crawl at concurrency 6, not an open-ended LLM loop.
One BullMQ job per `technical_audit_runs` row, running all eight checks
sequentially inside that single job, mirrors the old orchestrator's actual
shape and doesn't need Discovery's `pipeline_state`/`RunPausedException`
machinery. If a real run turns out to need more time than the queue's
default job timeout allows, that's a job-level timeout config change, not a
reason to rebuild Discovery's resumability design here.

## DB schema (3 tables, per the confirmed design — do not re-expand)

### `technical_audit_runs`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| project_id | uuid fk → projects.id | |
| status | enum `TechnicalAuditStatus` (`QUEUED, RUNNING, COMPLETE, FAILED`) | |
| triggered_by | enum `AuditTrigger` (`MANUAL, SCHEDULED`) | |
| previous_audit_id | uuid, self-fk, nullable | the chain each run diffs against; resolved *before* this run is persisted |
| score | int, nullable | composite, renormalized over whatever components ran |
| result | jsonb | robots/cdn/js-render/cwv/schema/sitemap/agent-readiness analyses + page metadata + observability — one blob, same pattern as `company_context_profiles.profile_json` |
| findings | jsonb | normalized `AuditFinding[]` |
| deltas | jsonb | computed once at compile time against `previous_audit_id`, never recomputed later |
| narrative / narrative_model | text, nullable | |
| started_at / completed_at | timestamptz, nullable | |
| created_at | timestamptz | |

No `deleted_at` — append-only, same reasoning as Discovery's tables.

### `audit_pages`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| technical_audit_run_id | uuid fk | |
| project_id | uuid fk | denormalized, same pattern as `discovered_pages` |
| url | text | |
| status_code | int | |
| score | int | |
| issues | jsonb (string array) | real column — "worst pages" sorts/filters on it |
| signals | jsonb | title/meta/h1/canonical/word-count/image-counts — detail nothing queries independently |

A real table, not JSON-in-the-run-blob, specifically so deltas can diff two
runs' page sets by URL (`comparePages`) without deserializing every row's
full JSON. No `deleted_at`.

### `technical_audit_schedules`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| project_id | uuid fk, unique | one schedule per project |
| cadence | enum `AuditCadence` (`WEEKLY, MONTHLY, MANUAL_ONLY`) | (old repo also had `daily` — dropped per the confirmed 3-value design) |
| active | bool | a schedule being off is `active = false`, never a delete |

No `next_run_at` — BullMQ's job scheduler tracks that; not duplicated in
Postgres. No `deleted_at`.

## Scheduling: BullMQ `upsertJobScheduler`, not a cron fallback

The old `audit-scheduler.service.ts` is an in-process `@nestjs/schedule`
hourly cron, built specifically because that deployment had no Redis (its
own header says BullMQ was the *preferred* path when available, and that
this scheduler and a BullMQ one "must never both be armed, or every project
gets audited twice"). We have Redis + BullMQ already; this file is not
ported, it's replaced.

Three behaviors the old code has that a naive `upsertJobScheduler(id,
{pattern: cron}, ...)` does **not** reproduce for free, and that need
deliberate handling:
1. **Next run measured from completion time, not from a missed slot** — a
   scheduler that was down for a day doesn't fire a backlog of catch-up
   runs, and a failing audit still advances its next-run time so a
   permanently-broken site doesn't retry hourly forever.
2. **Never two audits for the same project concurrently** (the old
   in-process boolean mutex) — a concurrent run for one project would
   corrupt the previous-run diff chain (`previousAuditId` resolution reads
   "most recent scored run" with no locking).
3. **Audits run one at a time site-wide**, not per-project-parallel — each
   audit drives a real browser render + a PSI call + a ~150-page crawl;
   running several concurrently risks the cost ceiling and rate limits.

Confirmed against the installed `bullmq@6.3.8` (`node_modules/bullmq/dist/
esm/classes/queue.d.ts`): `upsertJobScheduler(jobSchedulerId, repeatOpts,
jobTemplate?)` — `repeatOpts` is `Omit<RepeatOptions, 'key'>`, either a cron
`pattern` or a plain `every` interval. `removeJobScheduler`/
`getJobSchedulers` exist for management. The scheduler is upsert-by-id, so
re-calling it with the same `jobSchedulerId` updates rather than duplicates.

**Proposed design**: one BullMQ queue (`technical-audit`), concurrency
capped at 1 (addresses behavior 3 directly — the queue itself is the
sequencing mechanism, no separate mutex needed). A project's schedule is
one job scheduler, `jobSchedulerId = technical_audit_schedules.id`, upserted
with `every: <cadence in ms>` (not a calendar `pattern` — behavior 1 needs
"next run ≈ last completion + interval," which is what an interval-based
repeat option is for; a `pattern` is calendar-grid-based and would not carry
that semantic). Whether BullMQ's `every` variant already computes its next
iteration from actual completion time, or from the previous scheduled time
regardless of when the job actually ran, needs confirming empirically
against the real library behavior before I commit to it being sufficient
on its own — flagged in "Open questions." If it does not, the fallback is a
job that re-upserts its own scheduler with a fresh `every`/`startDate` from
inside its own completion handler, which guarantees behavior 1 regardless
of the library's default. Behavior 2 (no concurrent runs for one project)
needs its own guard independent of the global concurrency-1 setting, since
a manual trigger and a scheduled trigger could otherwise race for the same
project — checked against `technical_audit_runs` for an existing
`QUEUED`/`RUNNING` row for the project before enqueuing either kind.

## Decisions confirmed before code

1. **The sitemap-sharing refactor** (above): extracting a shared
   sitemap-discovery primitive that Discovery's shipped `discover.stage.ts`
   is rewired to call, changing its behavior for the one case (multiple
   declared `Sitemap:` lines) its current tests don't exercise. Design as
   written above. Discovery's full test suite is re-run before/after and
   must show zero regressions.
2. **`discovered_pages` reuse scope** (above): narrower than "skip the
   fetch" — pre-fills title/meta/JSON-LD/word-count from a fresh row, and
   uses a plain fetch instead of a render only when Discovery already
   rendered the same URL successfully and js-render hasn't flagged the site
   as JS-dependent.
3. **Agent-readiness's public-report exposure** — confirmed with the user:
   run by default, matching the shipped reference's actual code. See
   "Agent readiness" above.
4. **BullMQ `every`'s exact completion-time semantics** — verified against
   the installed library during the scheduler's build (below), not a
   blocking question for the rest of the module.

## Testing plan

Same rigor as Discovery: unit tests per check (mocked fetcher/PSI/LLM/
is-agentic subprocess), the SEO rubric's exact bands/weights/branching
tested as pure-function cases (no I/O to mock), the deltas module tested as
pure functions directly, one live end-to-end run against a real domain with
all test rows (`technical_audit_runs`, `audit_pages`,
`technical_audit_schedules`, plus the temp `clients`/`projects` rows)
deleted afterward. Live verification additionally confirms: the shared
sitemap primitive actually reads every declared entry point against a real
multi-sitemap site if one can be found for the test, the scheduler's
completion-time semantics hold across at least one real re-schedule, and
Discovery's own test suite is green both before and after the shared
sitemap extraction.
