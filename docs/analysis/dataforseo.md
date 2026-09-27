# DataForSEO (scheduled-data) — analysis

Short design note. The module is built; the full operational detail lives
in `backend/src/modules/dataforseo/README.md`.

## Problem

Projects need recurring paid SERP/backlink/keyword data (rank tracking,
backlink deltas, keyword stats) without an operator hand-pulling it each
week. This module owns the scheduled pull + append-only snapshot store.
It does not analyze — downstream modules read snapshots.

## Decisions

- **Two tables** (`dataforseo_schedules`, `dataforseo_snapshots`), same
  append-only discipline as every other pipeline module: off is
  `active: false`, snapshots are create-only (no update/delete path
  anywhere — service or HTTP).
- **Scheduler shape copied from Social Activity**: one BullMQ job
  scheduler per project (`upsertJobScheduler`, `WEEKLY`/`MONTHLY`/
  `MANUAL_ONLY`), plus `spendOptIn` — a scheduled tick with no opt-in
  writes no rows and spends nothing.
- **One deliberate difference: stored `next_run_at`.** Technical Audit
  and Social Activity keep next-fire-time only in BullMQ. Here the tick
  honors a stored `nextRunAt` (advanced before the collect runs) so a
  missed interval never fires catch-up backlogs and the due time is
  inspectable in Postgres without reading Redis.
- **Dataset keys are strings, not an enum** — a fourth dataset later
  must not require a migration.
- **Mock-only build, hard constraint.** All paid paths go through a
  deterministic offline adapter gated behind `DATAFORSEO_ALLOW_MOCK`
  (measurement's `MEASUREMENT_ALLOW_MOCK` pattern). The live adapter is
  a fail-closed stub that is not provided in the module, so no code path
  can read `DATAFORSEO_LOGIN`/`PASSWORD`; `SWARM_ALLOW_LIVE` stays `0`.
  Credentials are never logged or returned anywhere in this module.
- **Cost cap** `DATAFORSEO_MAX_COST_PER_RUN_USD` (default 5.00, same
  convention as the other paid modules): stop between datasets, report
  the skipped, never silently drop.

## Open questions (live wiring)

Real per-dataset pricing and which DataForSEO endpoints map to the three
dataset keys are deferred to the live-wiring pass with credentials and an
explicit spend authorization — see the module README's follow-up list.
