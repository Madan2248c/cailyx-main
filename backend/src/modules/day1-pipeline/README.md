# Day-1 pipeline module

The automatic end-to-end run: project creation → Discovery → Technical
Audit → Social Activity → Query Set (generate → activate) → AEO Audit →
Competitors → Gap Analysis → Reporting (DAY1, auto-RELEASED) → "your
audit is ready" email. Spec: `docs/analysis/day1-pipeline.md`.

## How it works

- `POST /team/clients/:id/projects` (with `day1SpendConsent: true`) creates
  the project, a `Day1PipelineRun` row, and enqueues one `day1-pipeline`
  job (`jobId` = pipeline id — duplicates impossible). Queue-down at
  creation is non-fatal: the row stays `QUEUED` for the retry endpoint.
- The processor runs the 9 stages **sequentially**. Async stages
  (discovery, technical-audit, social-activity) are started via their
  services and polled (~20s, `DAY1_POLL_INTERVAL_MS`); sync stages are
  awaited (AEO `run` blocks for minutes — expected, not a bug).
- Terminal semantics: `COMPLETE` = a DAY1 report was RELEASED (skipped
  stages are fine). `FAILED` = no report. **Only `reporting` is fatal** —
  every other stage failure is recorded in `stages` JSON and the pipeline
  continues.
- Retries resume: recorded completed/skipped stages are not re-triggered;
  resumable stages (queued runs, AEO audits) pick up where they left off.
  `GET`/`POST …/projects/:id/day1[/retry]` (admin) inspect and re-enqueue;
  retry rejects `COMPLETE`/`RUNNING` rows (re-running those double-spends).

## Spend

- Pre-auth at project creation (`day1SpendConsent` + optional
  `day1SpendCeilingUsd`, stored on the row). No mid-pipeline click.
- Before the paid stages (social-activity, aeo-audit), known spend (social
  `totalCostUsd` + AEO `costUsd`) is checked against the ceiling; reached →
  stage recorded `skipped: spend-ceiling-reached`. Best-effort (costs land
  after the fact); discovery SERP / tech costs have no run-level column
  and are not counted.
- Day-1 AEO surfaces: `DAY1_SURFACES` CSV (default `cloro_chatgpt`),
  markets `['US']`, module-default runCount.

## Final email

`TeamService.sendDay1ReadyEmail`: still-INVITED POC (the normal deferred
case) → fresh invite with ready context; already-ACTIVE → login-link
ready email; no POC / unconfigured → recorded skip. The email links at
the app — the client report viewer is unbuilt frontend work.

## Dependencies

- Modules: Discovery, TechnicalAudit, SocialActivity, QuerySet, AeoAudit,
  Competitors, GapAnalysis, Reporting, Auth (all via exported services —
  no cross-module DB reads). Measurement is driven internally by AEO.
- Env: `DAY1_SURFACES`, `DAY1_POLL_INTERVAL_MS` (both optional).

## Testing

- `services/day1-pipeline.service.spec.ts` (13 tests, mocked stages):
  start idempotency + queue-down, retry guards + legacy row creation,
  happy path to COMPLETE, failed-stage continuation, reporting-failure →
  FAILED, query-chain skip propagation, ceiling skips, resume skips
  recorded stages.
