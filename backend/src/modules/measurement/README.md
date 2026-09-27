# Measurement module (SOP-2)

Measures AI visibility: for every prompt in a project's **active** query
set, queries an AI answer surface via **Cloro** (cloro.dev — ChatGPT,
Perplexity, Gemini, Google AI Overview and AI Mode through one API instead
of a Playwright-driven browser session) n times, and scores each answer
into a structured `Observation` (mentioned / cited / position).

**Built ahead of a written analysis doc**, per explicit operator
instruction — every other module in this repo went analysis-doc-first.
Ported closely from the old repo's `measurement` module (Cloro adapter
family + orchestrator), adapted to this repo's schema (no
`Project.competitors` column exists here — see "Known gap" below).

## Architecture

```
modules/measurement/
  measurement.module.ts           # wiring; exports MeasurementService only
  measurement.constants.ts        # MIN_RUN_COUNT, cost cap, Cloro poll/timeout tuning
  measurement.types.ts            # Surface union, SurfaceAdapter, MeasurementSummary
  adapters/
    cloro.adapter.ts              # CloroClient (auth/poll/multi-key/concurrency) + 5 surface adapters
    mock.adapter.ts                # deterministic test-only surface, gated behind MEASUREMENT_ALLOW_MOCK
  controllers/
    measurement.controller.ts     # project-nested create/list/summary + run-id-scoped execute/read
  dto/
    measurement.dto.ts            # create-run body
  services/
    measurement.service.ts        # orchestrator: createRun, executeRun, listRuns, getRun, summary
    observation-scoring.ts        # pure mention/citation extraction, no I/O
```

Reuses the existing `JwtAuthGuard` / `RolesGuard` / `PermissionsGuard`. No
new permission: `view_projects` scopes reads, `ADMIN` gates writes (a run
create is cheap, `execute` spends real Cloro credit).

## Surfaces

Five Cloro-backed surfaces (`cloro_chatgpt`, `cloro_perplexity`,
`cloro_gemini`, `cloro_ai_overview`, `cloro_ai_mode`) plus `mock`
(test-only). The old repo's `claude`/`perplexity` first-party API adapters
and the `*-browser` Playwright-session adapters were **not** ported —
narrower scope, matching what was explicitly asked for ("Cloro wiring").
Adding a surface later means one new `SurfaceAdapter` implementation and a
map entry in `MeasurementService`'s constructor — the orchestrator itself
doesn't change.

## Cloro client: multi-key fallback + concurrency limit

`CLORO_API_KEY` is tried first, then `CLORO_API_KEY1`, `CLORO_API_KEY2`,
... — separate Cloro accounts, not one account's rotated secrets, so
exhausting one's credits doesn't stop a run. A rejected key (401/402/403)
advances `activeKeyIndex` so later tasks in the same run skip straight to
a working key rather than re-trying a dead one every time.
`CLORO_MAX_CONCURRENCY` (default 1, the free tier's limit) gates in-flight
tasks with a FIFO wait queue.

Async lifecycle only: `POST /v1/async/task` → poll `GET
/v1/async/task/{id}` every 3s (120s timeout) → the flat `response` field.
Google AI Overview is a `GOOGLE` task with `include.aioverview`, not its
own task type.

## Immutability gate

`createRun` only accepts a query set with `status: active` — 409
otherwise. This is what makes a measurement cohort comparable: Query
Set's own immutability guarantee (mutations only touch a `draft`) means an
active set's prompts never silently change out from under a run.

## Cost discipline

`MEASUREMENT_MAX_COST_PER_RUN` (default 5.00) — `executeRun` checks the
running total after every observation and stops (not mid-observation) the
moment it's crossed, marking the run `failed` with the reason. A `failed`
run's retry wipes its partial observations first so rates never
double-count. `runCount` floor is 1 (not the old repo's README-documented
"n>=5, no exceptions" — its own code had already lowered this to 1 on an
explicit prior operator override; ported the code's actual behavior, not
the stale doc).

## Known gap: no share-of-voice / competitor detection

The old repo read `Project.competitors` (a JSON column) to detect
competitor mentions and compute share-of-voice. That column doesn't exist
in this repo's schema — no competitor data source is wired in anywhere
yet. `MeasurementSummary.shareOfVoice` is always `[]`; mention/citation
scoring (the primary signal) is fully ported. Revisit once a competitor
source exists (Discovery's `CompanyContextProfile` doesn't carry one
either — checked).

## Public API

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/team/clients/:clientId/projects/:projectId/measurement/runs` | ADMIN | create; body `{ querySetId, surface, geo?, runCount? }`; 409 if set not active |
| GET | `/team/clients/:clientId/projects/:projectId/measurement/runs` | `view_projects` | list, `?surface=` filter |
| GET | `/team/clients/:clientId/projects/:projectId/measurement/summary` | `view_projects` | rates; `?runId=` scopes cohort |
| POST | `/team/clients/:clientId/measurement-runs/:runId/execute` | ADMIN | runs every prompt × n; spends real Cloro credit |
| GET | `/team/clients/:clientId/measurement-runs/:runId` | `view_projects` | run + observations |

## Env

`CLORO_API_KEY` (+ `CLORO_API_KEY1..20` for multi-account fallback,
optional), `CLORO_CREDIT_USD` (default 0.0004), `CLORO_MAX_CONCURRENCY`
(default 1), `MEASUREMENT_MAX_COST_PER_RUN` (default 5.00),
`MEASUREMENT_ALLOW_MOCK` (test-only, never `1` in prod).

## Testing

`observation-scoring.ts` is pure and tested directly (mention via
full-name / bare-brand-token / domain-host, citation position, malformed
URLs never throw). `CloroClient` tested against a mocked `fetch`: disabled
path never touches the network, submit→poll→COMPLETED, multi-key
fallback on a rejected key, every-key-fails, task-FAILED, credits summed
across keys treating a failing key as 0. `MeasurementService` tested with
mocked adapters + Prisma: surface/runCount/active-set validation, cost-cap
mid-run stop, failed-run retry wiping stale observations, per-observation
isolation, empty-cohort null rates. Controller scope pass-through covered.

**Live end-to-end run** against a real project (Fello/fello.ai) with real
Cloro spend — recorded in `docs/chagelog.md`. A small manually-created
2-prompt query set was activated and measured against `cloro_chatgpt`
(runCount 1): both observations completed, $0.004 total real spend, one
prompt correctly scored `mentioned: false, cited: false` (a generic
industry question that didn't surface the business), the other correctly
scored `mentioned: true, cited: true` (a branded question naming the
business directly) — confirming the mention/citation extraction logic
against real model output, not just fixtures.
