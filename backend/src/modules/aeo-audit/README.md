# AEO Audit module

Ties an **active** query set to one or more Measurement runs (one per
surface × market), judges each resulting observation's stance (a separate
LLM call, distinct from Measurement's deterministic mentioned/cited
scoring), and assembles a verdict: raw rate slices + plain-language
headlines. **No composite score** — ported faithfully from the old repo,
which computed none either.

Built ahead of a written analysis doc, per explicit operator instruction —
same as Measurement. Ported from the old repo's `aeo-audit` module; see
"What was kept, dropped, or changed" below.

## Architecture

```
modules/aeo-audit/
  aeo-audit.module.ts             # wiring; exports AeoAuditService only
  aeo-audit.constants.ts          # cost cap, stance/narrative tuning, the one 5pp threshold
  aeo-audit.types.ts              # Stance union, SliceMetrics, AeoVerdict, etc.
  controllers/
    aeo-audit.controller.ts       # project-nested create/list, audit-id-scoped run/read/verdict/narrative, competitor CRUD
  dto/
    aeo-audit.dto.ts              # create-audit body, competitor bodies
  services/
    aeo-audit.service.ts          # orchestrator: create, run (resumable), verdict reads, narrative regen
    aeo-verdict.ts                # pure: SliceMetrics + headlines from stored rows, no I/O
    aeo-comparability.ts          # pure: (querySetId, surfaces, markets) key — gates trend claims
    aeo-stance.service.ts         # LLM stance judge per observation, known-competitor filtering
    aeo-narrative.service.ts      # LLM narrative from verdict headlines, never invents a number
    competitor.service.ts         # the project's known-competitor list — single source of truth
```

Reuses `MeasurementModule` (drives its existing `createRun`/`executeRun` —
never re-implements the Cloro call) and `LlmModule`. Requires
`CloroClient` be exported from `MeasurementModule` so both modules share
one instance — a second `CloroClient` would run its own, uncoordinated
concurrency limiter. No new auth infrastructure; `view_projects` scopes
reads, `ADMIN` gates writes.

## Never generates its own query set

`create()` requires an already-active query set id — the layering
decision Query Set's own design doc recorded ("AEO Audit consumes an
active query set + measurement results and does not generate its own
prompts"). If no active set exists, create a Query Set first.

## Orchestration: `create()` (cheap) → `run()` (spends, resumable)

`create()` validates surfaces/active-set/non-empty-set, then creates one
`AeoAuditStatus.pending` row plus one `AeoSurfaceRun` per (surface,
market) pair, all `pending`. No spend yet.

`run()` drives every still-`pending` surface run: pre-flight credit
estimate (best-effort, `mock`/unknown-cost surfaces always pass), calls
Measurement's `createRun`/`executeRun`, records the result. **One
surface's exception or failure never aborts the others** — each is
independently try/caught. Stops starting *new* surface runs once the
audit-wide cost cap is crossed (marks the rest `failed` with
`failureKind: 'audit-cost-cap'`, leaving them resumable). If **zero**
surface runs complete, the whole audit is marked `failed`; otherwise
stance judging runs over every completed run's observations (sharing
whatever budget remains), the verdict is computed and cached, and a
best-effort narrative is written last (failure there is logged, never
fails the audit). Calling `run()` again on a partially-completed audit
only touches rows still `pending` — safe to resume after a crash or a
cost-cap stop.

## Stance judging: distinct from Measurement's scoring

Measurement's `mentioned`/`cited` are deterministic string matches.
Stance is an LLM's read of **how** the subject was positioned
(`recommended_primary` / `recommended_alternative` / `mentioned_neutral`
/ `mentioned_negative` / `absent`), plus named rivals. A rival name only
counts as `recommendedOver`/`losesTo` when it matches a **known**
`Competitor` row for the project (`tracked` or `candidate` both count) —
an unrecognized name is filtered into `otherNamesSeen` and queued as a
new `candidate` row, never silently promoted into a scored rivalry.
Known non-competitor platforms (ChatGPT, Google, review/social sites) and
the subject's own brand are filtered out of every name list.

## Competitor list: fixes a real gap in the old design

The old repo read `Project.competitors` (a seed JSON column) for known
rivals, but wrote newly-discovered names to a **separate** `Competitor`
table — the two never synced, so a confirmed candidate never fed back
into future stance passes. This repo has **one** `Competitor` table:
`status: tracked | candidate`, `source: manual | stance_discovered`. An
operator seeds `tracked` rows; stance judging writes `candidate` rows;
`knownNames()` (what stance judging is allowed to attribute a rivalry to)
reads both statuses from the same table. Confirming a candidate
(`POST .../competitors/:id/status`) immediately affects the next stance
pass — no separate sync step.

## Verdict: no composite score, by design

`buildVerdict()` is pure — `overall`/`unbranded`/`branded`/`byBucket`
(this repo's LLM-invented buckets, not the old fixed `PromptDimension`
taxonomy)/`byFunnelStage`/`bySurface` rate slices, `competitorStanding`
(times-ahead/behind/co-mentioned per rival), a `judged` block (raw stance
counts, top-25 losing/winning prompts) when any stances exist, and
`headlines` — hand-composed sentences quoting the raw numbers. **The only
numeric threshold anywhere in verdict assembly**: engines are called
"uneven" once the unbranded mention-rate gap between the best and worst
surface reaches 5 percentage points, else "consistent". Recomputable at
any time from stored rows (`GET .../verdict`) — the cached
`AeoAudit.verdict` is never trusted blindly by anything in this module.

## Narrative

Reframes `headlines` into customer-facing prose. Explicitly forbidden
from inventing a number — validated to reject empty output. Framed
against the prior completed audit's headlines only when
`areAuditsComparable()` says the two audits asked the same questions on
the same engines in the same markets; otherwise no trend claim is made.
Written after the verdict, via a compare-and-swap update so a concurrent
verdict recompute (e.g. from a stance re-judge) is never clobbered.

## What was kept, dropped, or changed vs. the old repo

**Kept, ported closely**: stance judging's classification + filtering
logic, comparability check (near-verbatim), verdict's rate-slice + no-
score design, narrative's never-invent-a-number contract, the audit-wide
cost cap separate from Measurement's own per-run cap.

**Dropped**: the old matrix generator (`aeo-matrix.*`, superseded by
Query Set's LLM-invented buckets), the old context service
(`aeo-context.service.ts`, superseded by Discovery's
`CompanyContextProfile`), the visibility read-composition endpoints
(`aeo-visibility.*`, UI glue for a screen that doesn't exist here yet),
and every `*-browser` Playwright-session adapter + the Cloro→browser
fallback chain (not asked for — Cloro-only, matching Measurement's own
scoping decision).

**Changed**: `Project.competitors` (seed JSON) + a separate candidates
table → one `Competitor` table, fixing the sync gap documented above.
`PromptDimension` slicing → `byBucket` (LLM-invented bucket names, since
this repo has no fixed taxonomy to slice by).

## Public API

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/team/clients/:clientId/projects/:projectId/aeo-audits` | ADMIN | create; body `{ querySetId, surfaces, markets? }`; 409 if set not active |
| GET | `/team/clients/:clientId/projects/:projectId/aeo-audits` | `view_projects` | list, newest first |
| POST | `/team/clients/:clientId/aeo-audits/:auditId/run` | ADMIN | drives pending surface runs, stance, verdict, narrative; spends real credit; resumable |
| GET | `/team/clients/:clientId/aeo-audits/:auditId` | `view_projects` | audit + surface runs |
| GET | `/team/clients/:clientId/aeo-audits/:auditId/verdict` | `view_projects` | recomputed fresh, no spend |
| POST | `/team/clients/:clientId/aeo-audits/:auditId/narrative` | ADMIN | regenerate on demand |
| GET | `/team/clients/:clientId/projects/:projectId/competitors` | `view_projects` | list |
| POST | `/team/clients/:clientId/projects/:projectId/competitors` | ADMIN | seed a `tracked` row |
| POST | `/team/clients/:clientId/competitors/:id/status` | ADMIN | confirm/demote a candidate |

## Env

`AEO_MAX_COST_PER_AUDIT` (default 10.00) — the only new var; reuses
Measurement's `CLORO_*` and `LlmModule`'s existing keys.

## Testing

`aeo-comparability.ts` and `aeo-verdict.ts` are pure and tested directly
(order-independent keys, methodology-break rules; rate-slice math, empty-
slice omission, competitor tallying, headline thresholds, judged-summary
ranking). `AeoStanceService`/`AeoNarrativeService` tested against a mocked
`LlmService` (known-competitor filtering, noise stripping, quote capping,
never-empty-narrative validation). `CompetitorService` tested against a
mocked Prisma (candidate dedup, status scoping). `AeoAuditService` tested
with every collaborator (Measurement, Cloro, Stance, Narrative,
Competitor) mocked: create-time validation, cost-cap stop, per-surface
isolation, zero-success failure, candidate recording. Controller
pass-through covered. One live end-to-end run against a real project with
real Cloro + LLM spend is recorded in `docs/chagelog.md`.
