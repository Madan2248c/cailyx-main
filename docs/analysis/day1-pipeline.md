# Analysis — `day1-pipeline` module

Status: **shipped 2026-09-27 — operator calls: invite (A) deferred, surfaces ChatGPT-only.**

The auto-orchestrator that chains every backend module into one automatic
run. Intended flow (confirmed with the operator, 2026-09-27 — see
`docs/MODULES-STATUS.md` "The Day-1 pipeline orchestrator"):

```
Admin creates client + project (spend pre-auth on the form)
  → Discovery → Technical Audit → Social Activity
  → Query Set (generate → activate) → AEO Audit
  → Competitors → Gap Analysis → Reporting (DAY1, auto-RELEASED)
  → "your audit is ready" email to the client
```

Nothing today chains modules automatically. This is new infrastructure.
Stage contracts (trigger methods, completion predicates, spend gates) were
mapped 2026-09-27 from each module's source and are summarized in §3 —
that mapping is the spec's input, not repeated in full here.

## 1. Scope

A new `day1-pipeline` module that owns sequencing, retries, partial-failure
handling, and spend-ceiling enforcement. It does **not** reimplement any
stage logic — it calls each stage's exported service exactly as the admin
HTTP endpoints do (same methods, same guards), and reads stage state only
through those services' read methods (the gap/reporting collectors pattern —
no cross-module DB reads).

## 2. State — new table `Day1PipelineRun` (1:1 with project)

Day-1 runs once per project, so one row per project, created at project
creation:

- `projectId` unique, `status`: `QUEUED → RUNNING → COMPLETE | FAILED`
  - `COMPLETE` = a DAY1 report was RELEASED (even with skipped stages —
    Reporting tolerates missing sources, so a missing source is not an
    error at this layer either).
  - `FAILED` = no report was released (pipeline error, or every source
    stage failed/skipped and reporting itself failed).
- `currentStage` (stage key below, for observability/resume).
- `stages Json` — per-stage record `{ status: completed|failed|skipped,
  runId?, error?, skippedReason? }`. The retry contract: a retried job
  skips stages already recorded completed/skipped and resumes polling an
  async stage whose recorded run is still active.
- `spendCeilingUsd Float?` — the admin's optional ceiling from project
  creation (§5). Null = uncapped (per-module caps still apply).
- `spendAuthorizedAt DateTime` — when the pre-auth was given (§5).
- `reportId?` — the released DAY1 report on success.
- `error?`, `startedAt`, `finishedAt`.

## 3. Stage sequence (sequential v1)

Parallel fan-out (tech + social + query-chain concurrently) is left out
deliberately: a single sequential job is simpler, robust, and resumable,
and Day-1 wall-clock is dominated by discovery/tech/AEO anyway. Revisit
only if Day-1 latency becomes a complaint.

| # | Stage key | Trigger (service call) | Done when | Skipped when |
|---|---|---|---|---|
| 1 | `discovery` | `DiscoveryService.startRun(projectId, 'project-created')` | status in `COMPLETE / COMPLETE_WITH_GAPS / MANUAL_REVIEW_REQUIRED` (all three proceed — a profile may still exist) | failure → record, continue (downstream stages skip without their inputs; only `reporting` is fatal) |
| 2 | `technical-audit` | `TechnicalAuditService.startRun(projectId, 'manual')` | `COMPLETE` | discovery produced nothing usable? No — tech needs no discovery output; runs always. Failure → record, continue |
| 3 | `social-activity` | `SocialActivityService.startRun(projectId, 'manual')` | `COMPLETE` | failure → record, continue. (Service-level `startRun` carries no `confirmSpend` gate — the HTTP `rerun` gate stays for manual triggers; the pipeline's spend pre-auth (§5) is the authorization here.) |
| 4 | `query-set` | `QuerySetService.generate(clientId, projectId)` then `activate(clientId, newSet.id)` | an `active` set exists afterwards | generate 409s (no CompanyContextProfile, guardrail rejection) → record, continue without an active set |
| 5 | `aeo-audit` | `AeoAuditService.create(clientId, projectId, {querySetId, surfaces, markets})` then `run(clientId, audit.id)` | audit `completed` (partial surface failures OK — per-surface `failed` rows are normal) | no active query set → record `skipped: no-active-query-set`, continue |
| 6 | `competitors` | `CompetitorsService.discover(clientId, projectId)` | awaited return (synchronous; per-profile `OK/FAILED` tolerated) | never skipped on principle; throws → record, continue |
| 7 | `gap-analysis` | `GapAnalysisService.run(clientId, projectId)` | `COMPLETE` | 409 (zero completed sources) → record, continue |
| 8 | `reporting` | `ReportingService.generate(clientId, projectId, 'DAY1')` | `RELEASED` (immediate for DAY1) | never — throws → pipeline FAILED |
| 9 | `notify` | §7 email step | email sent (or debug-logged when unconfigured) | only if reporting failed (pipeline already FAILED) |

Async stages (1–3) are BullMQ-backed in their own queues: the orchestrator
polls status via each service's read methods (sleep ~20s between polls,
`job.updateProgress(stage)` heartbeat). Sync stages (4–9) are awaited
directly — `measurement.executeRun` and `aeo.run` block for minutes; that
is expected, not a bug.

Pre-stage spend check: before stages 3, 5 (the paid ones — Apify, Cloro),
sum known spend from recorded run rows; if `spendCeilingUsd` is set and
already reached, mark the stage `skipped: spend-ceiling-reached` and
continue. (Best-effort: costs land after the fact; the ceiling bounds
further spend, it cannot claw back spent cents.)

## 4. Queue mechanics

- New BullMQ queue `day1-pipeline`, concurrency 1, one job per pipeline run
  (`jobId = pipelineRun.id` — duplicates impossible). `attempts: 3`,
  exponential backoff. A throw anywhere → row stays `RUNNING` with
  `currentStage` + per-stage record → retry resumes (§2).
- Terminal states are written by the processor, never by retry exhaustion
  alone: on final-attempt failure the processor marks `FAILED` with `error`.
- No new scheduler: Day-1 runs once, at project creation.

## 5. Spend pre-authorization (project creation)

`POST /team/clients/:id/projects` gains two DTO fields:

- `day1SpendConsent: true` (`@Equals(true)` — 400 otherwise, same shape as
  social-activity's `confirmSpend`). Creating a project authorizes the
  automatic Day-1 spend; there is no mid-pipeline click.
- `day1SpendCeilingUsd?: number` (`@IsPositive()`, optional) → stored on
  the pipeline row, enforced per §3. Omitted = uncapped at this layer.

`ProjectsService.createProject` currently calls `discovery.startRun`
inline. That moves into the orchestrator: creation now creates the project
+ `Day1PipelineRun` row + enqueues the job (enqueue failure logged,
non-fatal — same posture as today's discovery-start failure). A project
must still be creatable if the queue is down; the pipeline row stays
`QUEUED` and an admin can re-enqueue (service method `retry(projectId)` —
also the recovery path for `FAILED` runs; new endpoint, admin-only).

Frontend: the create-project dialog gains the consent checkbox + optional
ceiling input (small patch to the existing dialog + BFF route passthrough).

## 6. Day-1 AEO surface set — needs operator call

`AeoAuditService.create` takes `surfaces[]` + `markets[]` (default
`['US']`). Cost scales with prompts × surfaces × markets at
`CLORO_CREDIT_USD` per call inside the `AEO_MAX_COST_PER_AUDIT` cap.
`runCount` is the module default (1) — thin rates, honestly nulled where
unmeasured; raising it is a cost/quality tradeoff for later, not this
module. Decided 2026-09-27: env `DAY1_SURFACES` (CSV, default
`cloro_chatgpt`), markets `['US']`.

## 7. Final "report ready" email — decided 2026-09-27: (A) deferred invite

The initial POC invite is **deferred until the report is ready**:
`createClientWithPoc` gains opt-in `deferInvite` (default `false` —
existing behavior preserved; the Day-1 admin flow passes `true`), so
client creation goes silent. The pipeline's final step then sends the
*first* invite with ready context ("your Day-1 audit is ready — set up
your account to view it", `/accept-invite` link) via a new
`TeamService.issueReadyInvite(clientId)`, which issues a fresh token for
the still-`INVITED` POC. Robust to drift: if the POC is already `ACTIVE`
(manual resend mid-pipeline, non-deferred client), the step sends a plain
"your audit is ready" login-link email instead — same branch, no failure.
This needs a small read addition on `TeamService` (POC email + status by
client — read-only, no new public endpoint).

The email links at the app, not the report itself — the client-facing
report viewer + prefilled onboarding are unbuilt frontend work (§8).

## 8. Out of scope

PDF export, client report viewer, prefilled onboarding UI, recurring
schedules for the new stages, parallel fan-out (§3), per-stage cost
ledger (spend is read off stage rows when needed).

## 9. Testing

Unit (`vitest`, mocked stage services + `EmailService`): full happy path
to `COMPLETE`; each stage failing/skipped → still `COMPLETE` when
reporting releases; reporting failure → `FAILED`; ceiling enforcement
skips paid stages; retry resumes past recorded stages; consent missing →
400 at project creation. Live E2E against a real domain comes after,
as the scheduled full-repo E2E pass.
