# Social Activity module

Stage 3 of the Day-1 pipeline (alongside Technical Audit). Given a project,
audits the company's social publishing activity across its verified profiles:
recent posts pulled via Apify actors, per-platform cadence aggregated over a
30-day window, dormant/infrequent findings stored as data. Auditing only —
no scores, no recommendations. See `docs/analysis/digital-presence-audit.md`
for the full design.

## Architecture

```
modules/social-activity/
  social-activity.module.ts      # wiring; exports SocialActivityService only
  social-activity.constants.ts   # every tuned threshold/budget
  social-activity.types.ts       # platforms, targets, aggregates, findings, deltas
  controllers/
    social-activity.controller.ts# staff-facing inspection, nested under a client+project
  dto/
    social-activity.dto.ts       # trigger body (spend-gated) + schedule config
  queue/
    social-activity.queue.ts     # queue name, job payloads, retry/backoff options
    social-activity.processor.ts # @Processor('social-activity', concurrency 1) — thin; calls the orchestrator
  services/
    social-activity.service.ts   # orchestrator: run lifecycle, pulls, score-free compile, persistence
    social-activity.scheduler.ts # BullMQ job schedulers for WEEKLY/MONTHLY per project
    apify.service.ts             # Apify actor runs (async submit→poll→dataset) + guess-tolerant normalize
    social-activity.aggregation.ts# pure window aggregates, pattern buckets, findings, deltas
```

Reuses `LlmModule` (the one constrained-JSON client — no second LLM client),
`JwtAuthGuard` / `RolesGuard` / `PermissionsGuard` from `common/` — no new
auth infrastructure. No new permission: the existing `view_projects` scopes
reads, `ADMIN` gates triggers. Consumes Discovery's `social_profiles`
(verified company rows) — never re-discovers.

## The pipeline

Targets resolve from verified profiles → platforms pull sequentially in
config order (the cost ceiling needs ordering) → rows persist per actor
result → per-platform aggregation → findings → deltas → COMPLETE → best-
effort narrative.

Each platform is isolated: an actor throw becomes an `error`-status finding,
never aborts the run. Unpulled platforms past the spend ceiling are
`not-run` with reason `cost-ceiling`, not errors.

**Spend discipline (load-bearing).** Two gates, both required: `APIFY_API_KEY`
configured (fail closed, typed 503) AND explicit `confirmSpend: true` on the
trigger (400 without it — nothing run, nothing spent). Schedules carry their
own `spendOptIn`; a schedule without it fires nothing — no row, no spend.
Never two runs for one project concurrently (`startRun` returns the active
row); audits run one at a time site-wide (processor concurrency 1).

**No resume machinery.** Bounded actor runs complete inside one job. One
BullMQ job per `social_activity_runs` row; a retry re-enters `executeRun`,
sees a terminal row, and no-ops.

## Public API

See `docs/Readme.md` for full request/response shapes. Summary:

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/team/clients/:clientId/projects/:projectId/social-activity-runs` | ADMIN | body `{ confirmSpend: true, platforms?, postsPerPlatform?, windowDays?, includeProbable? }` — 400 without the opt-in |
| GET | `/team/clients/:clientId/projects/:projectId/social-activity-runs` | `view_projects` | run history, newest first |
| GET | `/team/clients/:clientId/social-activity-runs/:runId` | `view_projects` | one run + per-platform aggregates |
| GET | `/team/clients/:clientId/social-activity-runs/:runId/comparison` | `view_projects` | deltas vs previous |
| PUT | `/team/clients/:clientId/projects/:projectId/social-activity-schedule` | ADMIN | `{ cadence, spendOptIn?, platforms?, windowDays?, postsPerPlatform? }` |
| GET | `/team/clients/:clientId/projects/:projectId/social-activity-schedule` | `view_projects` | current schedule + config, or null |

## Dependencies

- **Modules**: `PrismaModule` (global), `LlmModule`, BullMQ `social-activity`
  queue (same Redis as the other queues — one instance, independent consumers).
- **Env**: `APIFY_API_KEY` (pulls fail closed without it), `APIFY_PLATFORMS` /
  `APIFY_POSTS_PER_PLATFORM` / `APIFY_ACTORS` (actor-map override),
  `SOCIAL_WINDOW_DAYS` / `SOCIAL_MAX_COST_PER_RUN_USD` — see
  `backend/.env.example`.

## Pattern buckets

`daily` (mean ≤ 1.5d) / `every-2-3-days` (≤ 3.5d) / `weekly` (≤ 8d) /
`sporadic` / `dormant` (zero in-window posts, or last post > 45d ago).
Buckets derive from the pulled sample (≤ `postsPerPlatform` posts): the mean
stays valid for high-volume accounts but the longest gap is a lower bound —
rows say so (`windowTruncated`).

## Testing

Unit tests per actor `buildInput`/`normalizeItem` (absent-fields→null),
aggregation pure-function cases (bucket edges, undated rows, truncated
windows), spend-gate tests (no key → 503 path, no opt-in → 400, scheduler
without opt-in fires nothing), orchestrator isolation/chain decisions with a
mocked adapter, controller scope pass-through, scheduler interval-vs-manual
branching. No live end-to-end run yet — that step (against a real project
with operator-confirmed Apify spend, temp rows deleted afterward) is still
open, and additionally confirms each actor's input/output shape before the
table above is treated as verified.
