# DataForSEO module (scheduled-data)

Scheduled pulls of paid SERP/backlink/keyword data per project, stored as
append-only snapshots. **This build is mock-only**: the only adapter wired
in is deterministic and offline — no live DataForSEO call exists anywhere
in this module, `SWARM_ALLOW_LIVE` stays `0`, and no credit can be spent.

**Built per explicit operator instruction**, following the
Technical Audit / Social Activity module shape (scheduler +
`upsertJobScheduler` cadence + spend opt-in) and measurement's mock-adapter
gating pattern.

## Architecture

```
modules/dataforseo/
  dataforseo.module.ts              # wiring; exports DataforseoService only (live adapter NOT provided)
  dataforseo.constants.ts           # cost cap default, mock per-dataset cost, period window, paging
  dataforseo.types.ts               # DATASETS, payload shapes, DataforseoAdapter
  adapters/
    mock.adapter.ts                 # deterministic offline fixtures, gated behind DATAFORSEO_ALLOW_MOCK
    live.adapter.ts                 # fail-closed stub — throws before touching config/network/credentials
  controllers/
    dataforseo.controller.ts        # project-nested collect/list/schedule + snapshot-id-scoped read
  dto/
    dataforseo.dto.ts               # collect + set-schedule bodies
  queue/
    dataforseo.queue.ts             # queue contract (manual collects + scheduled recurrences)
    dataforseo.processor.ts         # thin consumer: collectNow / fireScheduledTick
  services/
    dataforseo.service.ts           # orchestrator: collectNow, listSnapshots, getSnapshot
    dataforseo.scheduler.ts         # setSchedule/getSchedule/fireScheduledTick + cadenceIntervalMs
```

Reuses the existing `JwtAuthGuard` / `RolesGuard` / `PermissionsGuard`. No
new permission: `view_projects` scopes reads, `ADMIN` gates writes.

## Datasets

| Key | Payload | Live source (future wiring) |
|---|---|---|
| `serp-ranks` | `rankings: [{ keyword, url, position, prevPosition, volume }]` | SERP API `serp/google/organic/live/advanced` |
| `backlinks-summary` | `{ referringDomains, newBacklinks, lostBacklinks }` | Backlinks API `backlinks/summary/live` |
| `keyword-overview` | `keywords: [{ keyword, volume, difficulty, cpc }]` | Keywords Data API `keywords_data/google/search_volume/live` |
| `backlink-rows` | `backlinks: [{ sourceUrl, targetUrl, anchor, isDofollow, spamScore, firstSeen, lastSeen, lost }]` (12 rows) | Backlinks API `backlinks/backlinks/live` |
| `referring-domains` | `domains: [{ domain, backlinks, firstSeen }]` (top 10) | Backlinks API `backlinks/referring_domains/live` |
| `top-pages` | `pages: [{ url, backlinks, refDomains }]` (top 10) | Backlinks API `backlinks/pages/live` |
| `keyword-ideas` | `keywords: [{ keyword, volume, difficulty, cpc }]` (16 rows) | Labs API `dataforseo_labs/google/keyword_ideas/live` |
| `serp-snapshot` | `{ keyword, results: [{ position, url, title, features }] }` (top 10) | SERP API `serp/google/organic/live/advanced` |
| `domain-overview` | `{ rank, rankedKeywords, trafficEstimate, refDomains }` | Labs API `dataforseo_labs/google/overview/live` |

All nine fixtures are deterministic offline mocks shaped like the real
API responses (row counts mirror live pagination: top-10 lists, 12
backlink rows, 16 keyword ideas). Every dataset books the same flat
`MOCK_COST_PER_DATASET_USD` mock estimate ($0 billed — no credit can be
spent through the mock) and flows through the same cost-cap accounting in
`collectNow`.

Dataset keys are plain strings on the snapshot (not a Prisma enum), so a
new dataset later needs no migration.

## Scheduling

One BullMQ job scheduler per project (`every: 7d` / `30d`), plus a stored
`next_run_at` the tick honors: a tick fires nothing when the schedule is
inactive, `MANUAL_ONLY`, missing `spendOptIn`, or not yet due — no rows,
no spend. A missed interval never catches up: the row advances to
`now + interval` before the collect runs. `MANUAL_ONLY` clears
`next_run_at` and removes the recurrence.

## Append-only

Snapshots are never updated or deleted — no service method, no endpoint.
A re-collect supersedes by recency.

## Cost discipline

`DATAFORSEO_MAX_COST_PER_RUN_USD` (default 5.00) — `collectNow` gathers
datasets in request order and stops between datasets the moment the next
one would cross the cap; skipped datasets are reported in the response,
never silently dropped. A disabled mock gate (anything but
`DATAFORSEO_ALLOW_MOCK=1`) fails the whole collect closed: 503, nothing
stored.

## Public API

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/team/clients/:clientId/projects/:projectId/dataforseo-collect` | ADMIN | body `{ datasets? }`; 201 `{ snapshots, totalCostUsd, skipped }` |
| GET | `/team/clients/:clientId/projects/:projectId/dataforseo-snapshots` | `view_projects` | newest first, `?dataset=` filter |
| PUT | `/team/clients/:clientId/projects/:projectId/dataforseo-schedule` | ADMIN | `{ cadence, datasets?, spendOptIn? }`; `MANUAL_ONLY` removes recurrence |
| GET | `/team/clients/:clientId/projects/:projectId/dataforseo-schedule` | `view_projects` | schedule + `nextRunAt`, or null |
| GET | `/team/clients/:clientId/dataforseo-snapshots/:snapshotId` | `view_projects` | one snapshot, read-only |

## Env

`DATAFORSEO_ALLOW_MOCK` (test-only gate, default `0` — unset fails
closed), `DATAFORSEO_MAX_COST_PER_RUN_USD` (default 5.00).
`DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` already exist for the discovery
module's SERP sweep — this module never reads them (and never logs them).

## Testing

Mock gate (disabled by default, fixture shape per dataset — including
row-count bounds for `backlink-rows`/`keyword-ideas` and top-10 lengths
for `referring-domains`/`top-pages`/`serp-snapshot`), service
(unknown-dataset 400, cross-client 404, disabled-mock 503 with zero rows,
per-dataset rows with period + cost, append-only double-collect, cost-cap
stop + skipped report, read scoping), scheduler (cadence→ms mapping,
WEEKLY upsert + `nextRunAt`, MANUAL_ONLY removal, no-opt-in / not-due
 skips, tick advances `nextRunAt` then collects, empty-datasets default,
 dataset validation), controller (pass-through + ADMIN-only triggers / `view_projects` reads via
decorator metadata).

## Live-wiring follow-ups (NOT done — explicit)

1. Implement the DataForSEO REST calls in `adapters/live.adapter.ts`
   (SERP for `serp-ranks`/`serp-snapshot`, Backlinks for
   `backlinks-summary`/`backlink-rows`/`referring-domains`/`top-pages`,
   Keywords Data + Labs for
   `keyword-overview`/`keyword-ideas`/`domain-overview`; basic auth with
   login/password from config — never logged, never returned).
2. Gate adapter selection on `SWARM_ALLOW_LIVE=1` in the service (mock
   otherwise), with explicit per-collect spend confirmation.
3. Register `DataforseoModule` in `src/app.module.ts`.
4. Add `DATAFORSEO_ALLOW_MOCK` / `DATAFORSEO_MAX_COST_PER_RUN_USD` to
   `src/config/validation.schema.ts`.
5. Record real per-dataset costs on snapshots (mock estimates are not
   billed figures).
