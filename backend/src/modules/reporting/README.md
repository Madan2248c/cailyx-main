# Reporting module (SOP-11)

Assembles one report from the latest completed run of every other audit
module (Technical Audit, Social Activity, AEO Audit, Competitors, Gap
Analysis — read-only, via each module's own exported service, never
their Prisma models directly), renders it to a standalone HTML page, and
gates client visibility through an editorial lifecycle. See
`docs/analysis/reporting.md` for the design.

## Architecture

```
modules/reporting/
  reporting.module.ts             # wiring; exports ReportingService only
  reporting.types.ts              # ReportContent + every section shape
  reporting.constants.ts          # NARRATIVE_MAX_TOKENS, DEFAULT_SECTION_ORDER
  collectors/
    technical-audit.collector.ts  # latest COMPLETE run → TechnicalAuditSection
    social-activity.collector.ts  # latest COMPLETE run → SocialActivitySection
    aeo-audit.collector.ts        # latest completed audit → AeoAuditSection
    competitors.collector.ts      # latest snapshot → CompetitorsSection
    gap-analysis.collector.ts     # latest COMPLETE run → GapAnalysisSection
  services/
    report-content.ts             # pure: worst-first section order, run-over-run deltas
    report-narrative.service.ts   # one LLM call: the executive summary
    report-render.service.ts      # Handlebars view-model + render
    reporting.service.ts          # orchestrator: collect, generate, editorial lifecycle, share links
  templates/
    report.template.ts            # CSS (obsidian/linen/terracotta) + outer document shell + partials
    sections.template.ts          # one Handlebars template per section kind
  dto/
    reporting.dto.ts              # generate / approve bodies
  controllers/
    reporting.controller.ts       # 4 controllers — see Public API
```

Reuses `LlmModule` (no new provider) and imports `TechnicalAuditModule` /
`SocialActivityModule` / `AeoAuditModule` / `CompetitorsModule` /
`GapAnalysisModule` to reach their exported services. New dependency:
`handlebars`. The downloadable PDF reuses `FetcherModule`'s
`BrowserClientService.printPdf` (the Fix Plan PDF's Playwright printer, whose
Chromium ships in the API's Docker image) — no new dependency. Templates live
as TypeScript string constants (not loose `.hbs` files) since
`nest-cli.json` has no asset-copy step.

## Two independent axes, not one status field

`visibility` (PRIVATE/PUBLIC, share-link controlled) and `status`
(DRAFT/IN_REVIEW/RELEASED/WITHDRAWN, editorial-gate controlled) are
separate columns — neither is derived from the other. **DAY1 reports
bypass the editorial gate entirely**: `generate()` creates them straight
into `RELEASED` with `releasedRevisionId` already set. **MONTHLY**
reports go through the full state machine: `DRAFT → (review) →
IN_REVIEW → (approve) → RELEASED`, with `approve({approved:false})`
returning to `DRAFT`. `review()`/`approve()` both 409 on a DAY1 report —
there's nothing to gate.

## Collection: read-only, via each source's own service

Each collector reads the latest run with a completed status from its
source module's exported service and normalizes it into the
corresponding `*Section` shape (`null` if none exists — a missing source
is omitted, never fabricated, same discipline as Gap Analysis). A
project can generate a report with **zero** completed sources — a thin
but legitimate outcome, never a 409, since Day-1 timing means not every
source has necessarily run yet.

## Content assembly: pure functions, no I/O

`report-content.ts` has no side effects:

- **`worstFirstOrder`**: ranks only the sections actually present by a
  per-section "how damning" score (lower technical-audit score, more
  failing findings, lower AEO mention rate, more competitors outranking
  the subject → higher badness), ties broken by the fixed
  `DEFAULT_SECTION_ORDER`. Gap Analysis never leads on its own — it's the
  action plan, not a finding.
- **`computeDeltas`**: MONTHLY only, diffs a bounded set of
  already-computed, comparable numbers against the previous **RELEASED**
  report's frozen `contentSnapshot` — technical-audit score, summed
  social posts in window, AEO mention/citation rates. Never diffs a
  module missing from either side.
- **`buildSectionOrder`**: MONTHLY with deltas leads with a `deltas`
  section; DAY1 never does, even if deltas were somehow computed.

## Narrative: one LLM call, cited numbers only

`ReportNarrativeService.write()` builds a plain-text summary of every
present section + deltas as the prompt, and the system prompt enforces
"never state a number that isn't already given" — same discipline as AEO
Audit's narrative. On failure, `generate()`/`review()` fall back to a
placeholder string rather than blocking report creation.

## Render: Handlebars, view-model built in TypeScript

`ReportRenderService` compiles the document + section templates once
(module-level, shared across every render) and builds each section's
view-model — percentages, badge classes, kpi/bar-list arrays — in
TypeScript before handing it to the template. Templates stay dumb and
data-driven; no comparison logic lives in Handlebars. Design tokens
(obsidian `#14120D` / linen `#F7F3EA` / terracotta `#B8703F`, Jost +
Instrument Sans + Fraunces) are ported from the old repo's
`docs/day1-report-pdf-style-guide.md`, not from its HTML template (which
used a different, unrelated palette).

**PDF ("Download report").** `renderPrint` lays the same section
view-models out as the approved Day-1 diagnostic (the Faydo PDF): a
full-bleed dark cover (named `@page cover`, zero margin) with the agency ×
client lockup, "AI Visibility, *Day One.*" (MONTHLY: *This Month.*), a
meta grid and the score; then `01 Executive Summary` with up to four
headline tiles, then the present sections numbered from `02` with no gaps.
Print overrides (`PRINT_STYLE`) sit on top of `STYLE`, so the web page is
unchanged. Every figure comes from the content snapshot, and the cover date
is the report's own (released, else created) — never the render time.
`printDocument` reads through the same private lookup as `getOne`
(`ownedWithContent`), so the PDF cannot show content or reach reports the
report page can't.

## Persistence: `Report` + `ReportRevision` + `ReportShareLink`

Append-only, like every other pipeline module — a `ReportRevision` is
never edited after creation; `review()`/`approve(approved:true)` each
create a new numbered revision rather than mutating one in place.
`Report.releasedRevisionId` points at whichever revision is currently
client-visible; `getOne()`/`getBySlug()` return that frozen snapshot for
RELEASED/WITHDRAWN, or the latest revision live for DRAFT/IN_REVIEW.
`ReportShareLink.token` is a `randomBytes(24)` base64url string;
`revokedAt` disables it without deleting the row.

Two decisions filling gaps the analysis doc's 3-table schema left open:

- **`approve({approved:false, changesRequested})`**: `changesRequested`
  is accepted and logged, but not persisted — the schema has no column
  for it in this pass.
- **`withdraw()`**: the doc's API table lists no explicit withdraw
  endpoint, but the `status` enum includes `WITHDRAWN` — added as the
  reasonable completion of the state machine (409 unless the report is
  currently RELEASED).

## Public API

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/team/clients/:clientId/projects/:projectId/reports` | ADMIN | generate; DAY1 releases immediately, MONTHLY starts DRAFT |
| GET | `/team/clients/:clientId/projects/:projectId/reports` | `view_projects` | list, newest first, optional `?kind=` |
| GET | `/team/clients/:clientId/reports/:id` | `view_projects` | live content if DRAFT/IN_REVIEW, frozen released snapshot otherwise |
| GET | `/team/clients/:clientId/reports/:id/pdf` | `view_projects` | the same content as the row above, as a branded PDF attachment (`?format=html` returns the print HTML) |
| POST | `/team/clients/:clientId/reports/:id/review` | ADMIN | MONTHLY only — re-collects+re-renders fresh, DRAFT → IN_REVIEW; 409 on DAY1 |
| POST | `/team/clients/:clientId/reports/:id/approve` | ADMIN | MONTHLY only — release or send back to draft; 409 on DAY1 |
| POST | `/team/clients/:clientId/reports/:id/withdraw` | ADMIN | RELEASED → WITHDRAWN |
| POST | `/team/clients/:clientId/reports/:id/share-links` | ADMIN | issue a public token |
| DELETE | `/team/clients/:clientId/reports/:id/share-links/:linkId` | ADMIN | revoke |
| GET | `/reports/public/:token` | none | raw HTML; 404 unless the report is RELEASED and the link is live |
| GET | `/reports/:slug` | `view_projects` | client-portal read by slug; scoped to the caller's own client unless ADMIN (unscoped) |

The public and client-portal read routes return `text/html` directly via
`@Res()`, not JSON — no reporting frontend consumes structured content
yet, and the render pipeline already produces a complete standalone
page.

## Env

None new — reuses `LlmModule`'s existing `OPENROUTER_API_KEY` /
`ANTHROPIC_API_KEY`.

## Testing

`report-content.ts`'s pure functions are tested directly (section
ordering by badness and its default-order tiebreak, delta computation
skipping a module missing from either side, DAY1 never leading with
deltas). `ReportingService` is tested with every collaborator mocked:
DAY1 releases immediately, MONTHLY starts DRAFT, a zero-source project
still generates, narrative failure falls back to a placeholder rather
than blocking, the full editorial state machine (`review`/`approve`
409s on DAY1 and on the wrong status, `approve(false)` returns to draft
without touching revisions, `approve(true)` releases the newest
revision), `withdraw`'s 409 gate, `getPublic`'s revoked/never-released
404s, and `getBySlug`'s client-scoping (including the unscoped-ADMIN
path). Controller pass-through covered, including a regression test for
a bug caught and fixed while writing this module (below).

**Bug caught while writing, not by a later test**: `ClientPortalReportController.getBySlug`'s
first draft hardcoded `'*'` as the `clientId` argument passed to the
service — but that route has no `:clientId` URL parameter, so a literal
`'*'` would never match a real client and the endpoint would always 404
for scoped (non-ADMIN) callers. Fixed by deriving the caller's own
`clientId` from their JWT (`@CurrentUser()`, `null` for ADMIN =
unscoped) and threading it through `ReportingService.getBySlug()`.

**Live end-to-end run** against Fello — recorded in `docs/chagelog.md`.
