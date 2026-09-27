# Analysis — `reporting` module (SOP-11)

Status: **approved (2026-09-27), scoped to what's actually built today.**
Nothing built yet.

## What changed vs. the old codebase

The old `cailyx/backend/src/modules/reporting/` aggregated a lot that
doesn't exist in this rebuild yet: a weighted scoring rubric (`SubScore`/
`ScoreSummary`, PRD §8 bands), backlinks (DataForSEO), a separate
`competitors` module's gap diffing, a separate `progress` module, and its
own `entity-audit` schema checks. Six Prisma models: `Report`,
`ReportRevision`, `ReportShareLink`, `ReportDeliveryAttempt`,
`ReportPeriod`, `ReportTemplate`.

This rebuild **keeps the editorial-lifecycle machinery** (it's genuinely
good design — see "The two axes" below) but **scopes the content to what
this codebase has actually built**: Technical Audit, Social Activity, AEO
Audit, Gap Analysis. No new score rubric is invented — flagged explicitly
below since that's the one place scope-creep is tempting.

**New in this pass, per operator decision (2026-09-27)**: reports now come
in two `kind`s, `DAY1` and `MONTHLY`, sharing this one module rather than
being separate systems — see "Report kinds" below for how they differ.

## Scope

Given a project, assemble a report from the latest completed run of each
built audit module + the latest Gap Analysis consolidation, render it
(HTML, executive + detailed views), and gate client visibility through an
editorial lifecycle — except `DAY1` reports, which bypass that gate by
explicit operator decision (see below).

Explicitly out of scope, deferred until those modules/decisions exist:
- A composite weighted score across modules — Technical Audit has its own
  0-100 composite; AEO Audit deliberately has none ("ported faithfully,
  no composite score"). Reporting displays each module's own numbers,
  never invents a combined one.
- Backlinks (DataForSEO) — not yet an integrated tool/module in this
  rebuild.
- Actual PDF export and actual email delivery — see "Known gaps" below.

## The two axes (kept from the old design, unmodified)

`Report.visibility` and `Report.status` remain independent, never derived
from each other:

| Axis | Column | Question | Changed by |
|---|---|---|---|
| Public sharing | `visibility` | may anyone with the URL read the HTML? | share-link create/revoke |
| Editorial | `status` + `releasedRevision` | has this been reviewed and released to its client? | review/approve/publish/withdraw |

Revoking a public link never changes `status`. Releasing never mints a
public link. An unreleased report is invisible to its client regardless
of `visibility` — same invariant as before.

## Report kinds — where DAY1 and MONTHLY diverge

| | `DAY1` | `MONTHLY` |
|---|---|---|
| Trigger | once, automatically, at the end of the Day-1 pipeline (see `docs/analysis/day1-pipeline.md`) | recurring schedule, per project (BullMQ, same scheduler pattern as Technical Audit/Social Activity) |
| Baseline | none — this report *is* the baseline | diffs every metric against the project's previous `MONTHLY` (or `DAY1`, if it's the first) report |
| Editorial gate | **bypassed** — generates directly into `RELEASED` status. Per operator decision (2026-09-27): the very first report a new client sees has had zero human review, traded deliberately for a fully automatic onboarding flow. | **kept** — `DRAFT → in-review → approved → released`, same state machine as the old design, staff must release it |
| Section order | most-damning-first (no deltas to lead with) | "if a number went down, it goes in the headline" — deltas lead |
| `previousReportId` | null | the prior report this one diffs against |

Both kinds share the same `Report`/`ReportRevision` tables, render
template, and share-link mechanism — `kind` is a column, not a schema
fork.

## Content sources (read-only, via each module's own exported service)

| Source | What's pulled |
|---|---|
| `technical-audit` | latest run's composite score + findings + narrative |
| `social-activity` | latest run's per-platform findings + deltas |
| `aeo-audit` | latest completed audit's verdict headlines + stance + competitor standing |
| `gap-analysis` | latest run's ranked recommendations (the "what to do now" section) |

Same discipline as Gap Analysis: a project missing one or more sources
still generates a report (the section is omitted, not fabricated) — this
matters especially for `DAY1`, since the pipeline that feeds it can finish
some stages before others.

## Generation pipeline

```
1. Collect      pull latest completed run from technical-audit,
                social-activity, aeo-audit, gap-analysis (skip missing)
2. Diff         MONTHLY only: pull the previous report's frozen snapshot,
                compute per-metric deltas (pure function, no LLM — these
                are already-computed numbers being subtracted, not judged)
3. Narrative    one LLM call (reuses LlmModule): executive summary +
                section commentary, same "never invent a number, only
                describe cited ones" discipline as AEO Audit's narrative
4. Render       HTML (executive + detailed) via the existing
                report-html.hbs pattern, ported
5. Gate         DAY1 → RELEASED immediately. MONTHLY → DRAFT, awaits
                staff review/approve/release exactly as before.
6. Freeze       on release, snapshot the revision — what the client saw
                doesn't change if underlying data changes later.
```

## Entities

Reduced from the old design's 6 tables to 3 — `ReportPeriod` and
`ReportTemplate` are dropped as unnecessary indirection at this stage;
`ReportDeliveryAttempt` is dropped pending the email module decision (see
"Known gaps").

### `reports`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| project_id | uuid fk → projects.id | |
| kind | enum (`DAY1`, `MONTHLY`) | |
| slug | text, unique | for the public/share URL |
| status | enum (`DRAFT`, `IN_REVIEW`, `RELEASED`, `WITHDRAWN`) | `DAY1` skips straight to `RELEASED` |
| visibility | enum (`PRIVATE`, `PUBLIC`), default `PRIVATE` | independent of `status`, see above |
| title | text | |
| executive_summary | text | LLM-written, cited-numbers-only |
| previous_report_id | uuid fk → reports.id, nullable | `MONTHLY` only |
| source_technical_audit_run_id | uuid, nullable | |
| source_social_activity_run_id | uuid, nullable | |
| source_aeo_audit_id | uuid, nullable | |
| source_gap_analysis_run_id | uuid, nullable | |
| released_revision_id | uuid fk → report_revisions.id, nullable | |
| created_at / released_at | timestamptz, nullable | |

### `report_revisions`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| report_id | uuid fk → reports.id | |
| revision_number | int | |
| content_snapshot | jsonb | the frozen, rendered content as of this revision — what a client actually saw |
| created_at | timestamptz | |

### `report_share_links`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| report_id | uuid fk → reports.id | |
| token | text, unique | |
| revoked_at | timestamptz, nullable | |
| created_at | timestamptz | |

## API

| Method | Path | Notes |
|---|---|---|
| `POST` | `/team/clients/:clientId/projects/:projectId/reports` | trigger generation (`{ kind }`); `DAY1` is normally triggered by the pipeline, not called directly, but the endpoint exists for retries |
| `GET` | `/team/clients/:clientId/projects/:projectId/reports` | list, `?kind=` filter |
| `GET` | `/team/clients/:clientId/reports/:id` | one report, live content if `DRAFT`/`IN_REVIEW`, frozen snapshot if released |
| `POST` | `/team/clients/:clientId/reports/:id/review` | `MONTHLY` only — locks the revision |
| `POST` | `/team/clients/:clientId/reports/:id/approve` | `MONTHLY` only — `{ approved: true }` releases, `{ approved: false, changesRequested }` back to draft |
| `POST` | `/team/clients/:clientId/reports/:id/share-links` | mint a public share token |
| `DELETE` | `/team/clients/:clientId/reports/:id/share-links/:linkId` | revoke |
| `GET` | `/reports/public/:token` | token-only public render, no auth |
| `GET` | `/reports/:slug` | client-portal read, `view_projects` scoped |

`review`/`approve` on a `DAY1` report return `409` — there is nothing to
review, it's already released.

## Known gaps (explicitly not solved by this doc)

1. **No `competitors` module exists in this rebuild's plan.** The old
   codebase had a dedicated module producing a full `CompetitorProfile`
   per rival: tech-stack scan, schema/JSON-LD read, homepage SEO/content
   score on the **same rubric the client is scored on**, review ratings,
   plus AEO presence — "what do our competitors run, where do they
   already beat us." This is distinct from AEO Audit's `Competitor` table
   in this rebuild, which only tracks who gets named/recommended over the
   client **inside answer-engine responses** — a much narrower lens.
   Reporting's "competitor standing" content in this doc is AEO Audit's
   narrow version only. The broader tech/SEO/reviews comparison is not
   built anywhere yet and needs its own analysis doc + build pass before
   a report can show it — flagged for a decision rather than silently
   included or silently dropped.
2. **No email module exists.** Invite links today are only
   `Logger.debug`-logged (per `auth` module's own README). The Day-1
   pipeline's "send the client a magic link" step (see
   `docs/analysis/day1-pipeline.md`) has the same limitation until an
   `email` module is built and approved — that needs its own tool
   analysis (Postmark/Resend/SES options), not a silent pick here.
2. **No PDF export.** The rendered HTML is real; turning it into a
   downloadable/emailable PDF (the old design's `report-pdf.ts`) is
   deferred to a follow-up pass once HTML rendering is verified working
   end-to-end. Not the same thing as the separate, already-existing
   `docs/day1-report-pdf-style-guide.md` prospecting-PDF system, which
   stays out of scope entirely.

## Dependencies

- **Modules**: `PrismaModule` (global), `LlmModule`, `TechnicalAuditModule`,
  `SocialActivityModule`, `AeoAuditModule`, `GapAnalysisModule` — all
  read-only via exported services.
- **Consumers**: the Day-1 pipeline orchestrator (new module, see
  `docs/analysis/day1-pipeline.md`) triggers `DAY1` generation as its
  final step.
