# Analysis — `gap-analysis` module (SOP-5)

Status: **approved (2026-09-27) — consolidation model, not classification.**
Nothing built yet.

## What changed vs. the old codebase

The old `cailyx/backend/src/modules/gap-analysis/` was a **rules-engine
classifier**: it re-labeled raw findings from `technical-audit`/
`entity-audit` into a 6-dimension taxonomy (`visibility`, `narrative`,
`topic`, `format`, `web mentions`, `demand`) and a `fix|build|influence`
action, via a reviewable mapping table.

The user explicitly rejected this shape (2026-09-27): every audit module
already shows its own issues, and (per the decision below) will now show
its own recommended fixes too — re-classifying that into a *second*,
parallel taxonomy is the module **inventing things**, which is the one
behavior ruled out for this module. What Gap Analysis does instead:

**Read the recommendations that Technical Audit, AEO Audit, and Social
Activity each already produce, and consolidate them into one ranked list:
what matters most, right now, across everything.** No new taxonomy, no
re-derived findings, no numbers computed from scratch. Pure synthesis and
prioritization of what already exists.

## A dependency this doc creates for its source modules

None of the three source modules currently emit a "recommended action"
per finding — checked against the live code (2026-09-27):

- **Technical Audit** writes a 4-section LLM narrative from its findings —
  commentary, not a structured per-finding action list.
- **AEO Audit**'s narrative is explicitly *forbidden* from inventing
  recommendations — "reframes headlines into customer-facing prose...
  never invents a number." It describes what's happening, not what to do.
- **Social Activity** states outright: "Auditing only — no scores, no
  recommendations."

Per the user's decision, **Gap Analysis is the first and only place a
recommendation gets generated.** It does not require the three source
modules to change. It reads their raw findings (already fully available
through each module's own exported read methods) and is the one LLM call
in the whole audit pipeline that turns "here's what's wrong" into "here's
what to do about it, and here's what matters most."

## Scope

Given a project, pull the latest completed run from each source module
that has one, and produce a single ranked list of consolidated action
items — the most influential things to do immediately, each traceable
back to the specific finding(s) it's based on.

Explicitly out of scope: running any new audit, computing any new
score/metric, and reclassifying findings into a taxonomy the source
modules don't already use.

## Inputs (read-only, via each module's own service — no new tables copy data)

| Source | What Gap Analysis reads |
|---|---|
| `technical-audit` | latest `TechnicalAuditRun`'s findings + composite score + narrative |
| `social-activity` | latest `SocialActivityRun`'s per-platform findings + deltas |
| `aeo-audit` | latest completed audit's verdict headlines + stance judgments + competitor standing |

A project missing a completed run from one or more sources is not an
error — Gap Analysis runs on whatever is available and says so (a run
triggered with zero completed sources across all three is a 409: nothing
to consolidate).

## Generation pipeline

```
1. Collect     pull the latest completed run from each of the 3 source
                modules for this project (skip any with none)
2. Consolidate  one LLM call (reuses LlmModule — no new provider/tool):
                given every finding from every available source, produce
                a ranked list of action items. Each item must:
                  - cite the specific finding(s) it addresses (source
                    module + finding reference) — checked in code, see
                    guardrails
                  - merge related findings across sources into one item
                    where they're really the same underlying problem
                    (e.g. a missing sameAs link + a dormant LinkedIn
                    profile can be one "shore up LinkedIn presence" item,
                    not two disconnected ones) — this cross-source merge
                    is the actual value the module adds
                  - be written as a concrete next step, not a restated
                    finding
3. Rank         priority order from the same LLM pass — most influential
                first. No numeric score invented; rank is ordinal only,
                same "don't fabricate a number" discipline AEO Audit's
                narrative already follows.
4. Persist      GapAnalysisRun + Recommendation rows, each recommendation
                linked to its source finding references.
```

### Guardrails (enforced in code)

- **Rationale-grounding check**: a recommendation whose cited finding
  reference doesn't actually exist in the collected source data is
  rejected before persisting — same pattern as Query Set's bucket
  rationale check. This is what keeps the module from "inventing things."
- **No new numeric scores**: the LLM output is validated to contain no
  fabricated score/percentage not already present in a cited source
  finding.
- **Item count bound**: 3–15 recommendations per run. Below 3 isn't worth
  a consolidated view; above 15 stops being "what to do immediately."

## Entities

### `gap_analysis_runs`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| project_id | uuid fk → projects.id | |
| status | enum (`RUNNING`, `COMPLETE`, `FAILED`) | |
| source_technical_audit_run_id | uuid, nullable | which run was consolidated, if any |
| source_social_activity_run_id | uuid, nullable | |
| source_aeo_audit_id | uuid, nullable | |
| error | text, nullable | |
| created_at / completed_at | timestamptz | |

### `gap_analysis_recommendations`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| gap_analysis_run_id | uuid fk → gap_analysis_runs.id | |
| title | text | short, action-phrased |
| description | text | the concrete next step |
| priority_rank | int | ordinal, 1 = most influential |
| source_findings | jsonb | array of `{ module, findingRef }` — the grounding citations, checked at generation time |
| status | enum (`OPEN`, `DONE`, `DISMISSED`), default `OPEN` | operator-tracked, not set by generation |
| created_at / updated_at | timestamptz | |

Append-only run table (no `deleted_at` — a run is never edited, a new run
supersedes); `status` on recommendations is the one mutable field, since
staff need to track what's actually been done — set via `PATCH`, not
regenerated.

## API

| Method | Path | Notes |
|---|---|---|
| `POST` | `/team/clients/:clientId/projects/:projectId/gap-analysis/runs` | trigger a consolidation run against the latest available source runs; 409 if none exist |
| `GET` | `/team/clients/:clientId/projects/:projectId/gap-analysis/runs` | list, newest first |
| `GET` | `/team/clients/:clientId/gap-analysis/runs/:id` | one run + ranked recommendations |
| `PATCH` | `/team/clients/:clientId/gap-analysis/recommendations/:id` | update `status` only (`OPEN`/`DONE`/`DISMISSED`) |

## Env vars

None new — reuses `LlmModule`'s existing config.

## Dependencies

- **Modules**: `PrismaModule` (global), `LlmModule`, `TechnicalAuditModule`,
  `SocialActivityModule`, `AeoAuditModule` — all three imported read-only,
  via their exported services (no direct cross-module DB reads).
- **Consumers**: `reporting` (SOP-11) will surface the latest Gap Analysis
  run's top items in the monthly report.

## Open item for approval

The `status` (OPEN/DONE/DISMISSED) field on recommendations wasn't part of
the original ask — added because staff will act on these items and need
to track completion. Flagging in case you'd rather keep this module
strictly read-only (generate + display only) for a first pass and add
tracking later.
