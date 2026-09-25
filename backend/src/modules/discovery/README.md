# Discovery / company-context module

Stage 1 of the Day-1 pipeline. Given a project (a client's name + domain),
crawl that site and produce an **evidence-backed company-context profile**:
identity, descriptions, offerings, positioning, customers, geography,
go-to-market, credibility, organization, digital presence, technology — plus
the classified pages and verified social profiles it was built from.

Every material field in the output is an evidence-bearing object: a value, a
fact type, a confidence, and the quotes (with source URL, page type and fetch
date) that support it. An empty section is empty, never invented.

This module ends at "we have a synthesized, stored profile". Everything that
consumes it — AEO prompts, competitor seeding, the Day-1 report — is a later
module. See `docs/analysis/discovery.md` for the full design and the four
places the build departs from it.

## Architecture

```
modules/discovery/
  discovery.module.ts            # wiring; exports DiscoveryService only
  discovery.constants.ts         # every tuned threshold/pattern/target (ported verbatim)
  discovery.types.ts             # page/fact vocabularies + the output profile schema
  controllers/
    discovery.controller.ts      # staff-facing inspection, nested under a client+project
  queue/
    discovery.queue.ts           # queue name, job payload, retry/backoff options
    discovery.processor.ts       # @Processor('discovery') — thin; calls the orchestrator
  services/
    discovery.service.ts         # orchestrator: run lifecycle, stage loop, checkpoints
    pipeline-context.ts          # the stage contract (RunBudget, DiscoveryRunContext)
    pipeline-utils.ts            # ported pure helpers (crawl keys, JSON-LD, filters)
    llm.service.ts               # the one constrained-JSON LLM caller
    dataforseo-serp.service.ts   # the one SERP client (paid search is singular here)
    presence.types.ts            # platform vocabulary + expected-platform sets
    presence.signatures.ts       # URL → social platform/handle classification
    presence-discovery.service.ts# same-site social discovery (crawl + JSON-LD sameAs)
    presence-serp.service.ts     # SERP fallback sweep for platforms still missing
    social-verification.service.ts # the spec doc's point table, as scored verdicts
    bounded-search.service.ts    # shared engine: search → fetch → extract → validate
    stages/
      discover.stage.ts          # crawl: homepage, sitemap/robots, nav links, guessed paths
      inspect.stage.ts           # metadata + DOM-only extraction candidates
      select.stage.ts            # coverage-based page selection
      extract.stage.ts           # deterministic pass + batched LLM pass
      reconcile.stage.ts         # merge, resolve conflicts, compute confidence
      validate.stage.ts          # verbatim-substring check against the cited page
      social-discovery.stage.ts  # same-site → SERP fallback → score → persist
      external-enrich.stage.ts   # bounded search for fields with no first-party fact
      consolidate.stage.ts       # summary + a per-value keep/drop judgement, per populated category
      gap-research.stage.ts      # bounded search for consolidate's missing fields
      verify.stage.ts            # independent second read of consolidate's output
      compile.stage.ts           # assemble profile_json, score, persist the profile
```

## The pipeline

Stages run in this exact order — it **is** the resume contract, because a paused
run restarts from the stage after the last completed one (`discovery_runs.stage`):

```
discover → inspect → select → extract → reconcile → validate → social-discovery
        → external-enrich → consolidate → gap-research → verify → compile
```

Each stage gets a `DiscoveryRunContext`: it spends the run's budget, writes its
own rows through Prisma, and puts its result in `ctx.state`. The orchestrator
alone owns `status`, `stage`, `error`, the counters and `pipeline_state`.

**Resume semantics.** Every stage is written to be safely re-runnable. Pages
already fetched are not re-fetched; pages already extracted are not
re-extracted; select recomputes the same coverage deterministically. When the
elapsed budget (`DISCOVERY_MAX_ELAPSED_MS`, default 5 min) runs out, the run is
checkpointed, marked `PAUSED`, and a **continuation job is enqueued for the same
run** — the caller never has to catch a "paused" exception and retry, which is
what the old repo's HTTP-driven design required.

Job-level retry (BullMQ `attempts: 3`, exponential backoff) is a separate layer
from the per-page retry inside extract: the former covers "the worker crashed",
the latter "this one page's fetch or LLM call failed".

## Public API

See `docs/Readme.md` for full request/response shapes. Summary — all
staff-facing, nested under a client and project:

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/team/clients/:clientId/projects/:projectId/discovery-runs` | ADMIN | queue a fresh run (202) |
| GET | `/team/clients/:clientId/projects/:projectId/discovery-runs` | `view_projects` | run history |
| GET | `/team/clients/:clientId/discovery-runs/:runId` | `view_projects` | one run + its pages |
| GET | `/team/clients/:clientId/projects/:projectId/company-context` | `view_projects` | the current profile |
| GET | `/team/clients/:clientId/projects/:projectId/social-profiles` | `view_projects` | verified/candidate profiles |

There is **no client-facing trigger or UI** for this module, by design: a run
starts when an admin creates a project, and the client sees nothing until the
report module exists.

## Data model

Four tables, all append-only history (no `deleted_at` — a stale fact is marked
`status: "stale"` inside the JSON, and a new run supersedes the old row):

- `discovery_runs` — status, stage, budget counters, notes, profile version.
- `discovered_pages` — one row per page considered: URL, classified type, fetch
  status, cleaned visible text, raw JSON-LD, content hash.
- `social_profiles` — one row per accepted social profile, with its point-table
  score and verification band.
- `company_context_profiles` — the assembled `profile_json`, with its confidence
  and completeness.

Two `pipeline_state` jsonb columns (one on the run, one per page) hold
**in-flight pipeline state** — reconciled facts, category summaries, per-page
metadata and extracted facts. They exist so a re-enqueued job resumes instead of
re-spending LLM and search calls; they are columns, not tables, because the
module is deliberately capped at four tables. See `docs/analysis/discovery.md`
"As built".

No raw HTML is stored. Per page we keep the cleaned visible text **plus the raw
JSON-LD blocks**, which is what the verbatim validation checks excerpts against
— JSON-LD-sourced quotes only exist inside the `<script>` tag that visible-text
extraction strips out.

## Configuration

| Env var | Default | What it does |
|---|---|---|
| `REDIS_URL` | — | **Required at runtime.** BullMQ's queue state and the fetcher's cache/rate-limiter, one instance, two unrelated consumers. |
| `OPENROUTER_API_KEY` | — | The extraction/consolidation/verification LLM. Without it the pipeline still runs, deterministically (see "Known behaviours"). |
| `AEO_LLM_MODEL` | `deepseek/deepseek-v4.1-flash` | Model for the above. |
| `DATAFORSEO_LOGIN` / `_PASSWORD` | — | Paid search (social SERP fallback, external enrichment, gap research). Absent → those stages report "disabled" and skip. |
| `SWARM_ALLOW_LIVE` | `0` | **Deliberate kill switch.** Paid DataForSEO calls do not happen unless this is `1`, so a dev/test run can never burn search credits. |
| `PRESENCE_SERP_MAX_QUERIES` | `20` | Hard cap on SERP queries per social sweep, cumulative across re-enqueues. |
| `DISCOVERY_MAX_PAGES` / `_REQUESTS` / `_CHARS` / `_ELAPSED_MS` / `_RETRIES_PER_PAGE` | `12` / `40` / `24000` / `300000` / `2` | Per-run crawl budgets, fixed at run creation so a re-enqueue cannot silently widen them. |

A run fails closed on paid search and never guesses: no credentials or the kill
switch off means the stage records a note and moves on.

## Known behaviours worth knowing before debugging a thin profile

- **Offerings/valueProps/technology/etc. go through a value-judgement pass, not
  just the extraction prompt.** The extraction prompt tells the model what
  counts as a service; consolidation separately judges each already-extracted
  value one at a time and drops it if it turns out to be marketing copy
  (a call to action, a slogan, a section heading, a price line, a customer
  quote in a field about the company's own claims). Asking the model to *edit*
  a list in one call did not work — on a real site it returned every value
  unchanged — but judging one value at a time did. Values are judged in chunks
  of `VALUE_JUDGEMENT_CAP` (40), never truncated: a category with more values
  than one call can hold is judged across several calls, because a truncated
  first version silently kept everything past the cut. See
  `discovery.md` "As built" items 9–10 for the measured before/after.
- **Without an LLM provider the profile is built from deterministic extraction
  only** — the JSON-LD and heading candidates, with no category summaries. A
  category that has facts still reports nothing missing, so completeness
  reflects what was actually found rather than whether a model was reachable.
  (The shipped code's no-LLM branch reported every field missing, scoring 0
  completeness after a successful extraction; that is deliberately not
  reproduced — see "As built".)
- **Walled platforms can never be `VERIFIED`.** LinkedIn, Instagram, Facebook, X,
  TikTok and Threads block logged-out fetches, so a profile there can only earn
  the "official site links to it" signal. That ceiling is honest, not a gap to
  work around. Crunchbase, G2 and Glassdoor are on the same list — they block
  automation too, despite the design doc once naming them as fetchable
  examples.
- **The discover stage counts one "request" per page visited, but makes up to
  two HTTP calls for it** (a status check, then a headless render). Ported
  behaviour, kept because the request budget is really a page-visit budget; the
  fetcher's own rate limiter is what bounds politeness.
- **A profile found only via SERP caps at `PROBABLE`** (it never earns the link
  signal). `VERIFIED` means the company's own site links the profile.
- **Score is stored for walled platforms too** (e.g. 65 = link + name match),
  which is more informative than the `null` the design doc's column comment
  anticipated. See "As built".
- **Costs are recorded as `__cost__:<usd>:<model>` notes** on the run, not in a
  column — no field in the approved schema carries per-run cost.
- **`POSSIBLE` social profiles are stored but not compiled into the profile**;
  they stay queryable for human review.
- **Social profiles are deduped by URL, not by account.** One account reachable
  under two URL forms — `twitter.com/x` and `x.com/x`, a YouTube channel id and
  its `@handle` — is stored as two rows. A deep link (a GitHub *repository* the
  site links to) is likewise classified as a profile and can score well, because
  the scorer cannot tell a company's profile from its repository. Both come from
  the URL-level classifier this module deliberately reuses; a later module that
  needs a canonical per-platform identity should resolve it rather than adding a
  second string heuristic here.
- **A run with no legal name on the site ends up `MANUAL_REVIEW_REQUIRED`.** The
  identity gate is the old code's categorical scale (0.8 only when a legal name
  was found), so a site publishing just a brand name scores 0.6 and is flagged
  for a human — by design, but it means the flag is common, not exceptional.
- Some schema sections (`products`, `buyer_roles`, `team_size`, `testimonials`,
  …) have no fact source in this pipeline yet and stay empty, surfacing as
  `missing_fields` rather than being filled with something plausible.

## Provenance

The pipeline, its tuned constants and its prompts are ported from the old
repo's `aeo-audit/aeo-context.service.ts` (the shipped implementation of the
same spec), with `fetcher/`, `aeo-llm.service.ts`,
`serp-intelligence/dataforseo-serp.service.ts` and
`digital-presence/presence.*` ported alongside it. Persistence is rewritten
against the four tables above. Where that code and the spec doc disagreed, the
doc records which won and why; the short version is **tuned numbers from the
code, schema and structure from the doc**. PageSpeed Insights is deliberately
not part of this module (it belongs to the Technical Audit module).

## Testing notes

Unit tests are per stage, next to each file, with Prisma, the fetcher, the LLM
and the search clients all mocked — no network, no DB, no Redis. Run:

```bash
cd backend && npx vitest run src/modules/discovery
```

**Live verification** (anything that touches the real pipeline) runs against the
live Supabase database, and there is no separate test database — so the
discipline is: create your `clients`/`projects` rows, run, inspect, then delete
**every** row you created, including `discovery_runs`, `discovered_pages`,
`social_profiles` and `company_context_profiles`. The `notes` column and the
`pipeline_state` columns are where to look when a live run behaves oddly; the
run-inspection endpoint exists for exactly that.

Live verification should additionally confirm that the SERP fallback only
queries for platforms same-site discovery did not find, and that
`PRESENCE_SERP_MAX_QUERIES` holds as a hard cap — both are unit-tested, but they
are the assertions most worth re-checking against a real site, because they are
the ones that cost money when wrong.

## Not in this module

AEO prompt construction, competitor analysis, keyword research, brand voice and
report assembly — all separate modules that *read* this module's output. Also
deferred, with the design doc noting where each belongs: the human-readable
Markdown/HTML report, multilingual-site handling, and marketplace/franchise
entity separation.
