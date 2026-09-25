# Technical Audit module

Stage 2 of the Day-1 pipeline. Given a project (a client's name + domain),
crawl that site and run eight technical/SEO checks — robots.txt analysis,
CDN/bot-block probing, JS-render dependency detection, Core Web Vitals
(PageSpeed Insights), schema.org analysis, sitemap analysis, agent-readiness
(AI-crawler accessibility), and a per-page SEO inventory — then roll them
into one 0-100 composite, diff the run against the project's previous audit,
and write an LLM narrative. See `docs/analysis/technical-audit.md` for the
full design.

## Architecture

```
modules/technical-audit/
  technical-audit.module.ts      # wiring; exports TechnicalAuditService only
  technical-audit.constants.ts   # every tuned threshold/budget (ported verbatim)
  technical-audit.types.ts       # findings, analyses, deltas, result blob
  controllers/
    technical-audit.controller.ts# staff-facing inspection, nested under a client+project
  dto/
    technical-audit.dto.ts       # schedule cadence only (runs need no body)
  queue/
    technical-audit.queue.ts     # queue name, job payloads, retry/backoff options
    technical-audit.processor.ts # @Processor('technical-audit', concurrency 1) — thin; calls the orchestrator
  services/
    technical-audit.service.ts   # orchestrator: run lifecycle, checks, score, deltas, persistence
    technical-audit.scheduler.ts # BullMQ job schedulers for WEEKLY/MONTHLY per project
    audit-context.ts             # the check contract (run id, project, target URL)
    psi.service.ts               # PageSpeed Insights API v5 (all four categories, one call)
    page-metadata.service.ts     # best-effort title/meta/headings/positioning copy
    narrative.service.ts         # four-section LLM commentary via the shared LlmService
    technical-audit.deltas.ts    # pure run-over-run diff (16-metric registry)
    checks/
      robots.check.ts            # via RobotsService (spec-correct parser, not a second one)
      cdn.check.ts               # 5-concurrent bot probes vs a browser control
      sitemap.check.ts           # shared discoverSitemapTree across every declared entry point
      js-render.check.ts         # JS-on vs JS-off render, content-loss %
      cwv.check.ts               # PSI result rated against Google's bands
      schema.check.ts            # JSON-LD, Organization/Person, 10-URL sameAs verify
      agent-readiness.check.ts   # is-agentic CLI first, read-only API fallback
      page-inventory.check.ts    # sitemap URLs → rubric scores, two-pass duplicate-content
      page-signals.ts            # cheerio extraction (title/meta/canonical/headings/images/JSON-LD)
      seo-rubric.ts              # exact bands/weights/branching (ported verbatim)
```

Reuses `FetcherModule` (every HTTP/browser call), `LlmModule` (the one
constrained-JSON client Discovery also uses — no second LLM client),
`JwtAuthGuard` / `RolesGuard` / `PermissionsGuard` / `@CurrentUser` /
`@Roles` / `@RequirePermission` from `common/` — no new auth
infrastructure. No new permission: the existing `view_projects` scopes
reads, `ADMIN` gates triggers.

## The pipeline

Checks run in this exact order — cheap access questions before the
expensive crawl:

```
robots → cdn-inferred → sitemap → js-render → cwv → schema
       → agent-readiness → page-inventory
```

Each check gets an `AuditContext` and returns an `AuditFinding` (sitemap
and page-inventory additionally return their entries/pages for the next
step). The orchestrator alone owns `status/score/result/findings/deltas/
narrative` and the `audit_pages` rows. Every check is isolated: a throw
becomes an `error`-status finding, never aborts the run. `page-inventory`
only runs when `sitemap.entries.length > 0` — otherwise a `not-run`
finding, not an error.

**No resume machinery.** Unlike Discovery's pipeline (long enough to need
elapsed-budget pause/resume across jobs), these are bounded HTTP/browser
calls that complete inside one job. One BullMQ job per
`technical_audit_runs` row; a BullMQ retry re-enters `executeRun`, sees a
terminal row, and no-ops.

**Never two audits for one project concurrently.** `startRun` returns the
active (`QUEUED`/`RUNNING`) row instead of creating a second one — a
concurrent run would corrupt the previous-run diff chain. Audits run one
at a time site-wide (processor concurrency 1) to protect the cost ceiling.

## Public API

See `docs/Readme.md` for full request/response shapes. Summary:

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/team/clients/:clientId/projects/:projectId/technical-audit-runs` | ADMIN | queue an audit (202, returns the run) |
| GET | `/team/clients/:clientId/projects/:projectId/technical-audit-runs` | `view_projects` | run history, newest first |
| GET | `/team/clients/:clientId/projects/:projectId/technical-audit-trend` | `view_projects` | score history, oldest first |
| GET | `/team/clients/:clientId/technical-audit-runs/:runId` | `view_projects` | one run + worst 100 pages |
| GET | `/team/clients/:clientId/technical-audit-runs/:runId/comparison` | `view_projects` | deltas + page churn vs previous |
| PUT | `/team/clients/:clientId/projects/:projectId/technical-audit-schedule` | ADMIN | `{ cadence: WEEKLY\|MONTHLY\|MANUAL_ONLY }` |
| GET | `/team/clients/:clientId/projects/:projectId/technical-audit-schedule` | `view_projects` | current schedule or null |

## Dependencies

- **Modules**: `PrismaModule` (global), `FetcherModule`, `LlmModule`, BullMQ `technical-audit` queue (same Redis as Discovery's queue and the fetcher cache — one instance, independent consumers).
- **Env**: `PSI_API_KEY` (CWV check throws → `error` finding when unset), `AGENT_READINESS_CLI`/`AGENT_READINESS_TIMEOUT_MS`, `TECHNICAL_AUDIT_PAGE_CRAWL_BUDGET`/`_CONCURRENCY`/`_MAX_COST_PER_RUN_USD` — all optional, all fail closed. See `backend/.env.example`.

## Composite score

Weighted average over six components (`COMPOSITE_WEIGHTS`, sum to 100):
`access: 25`, `rendering: 15`, `structured: 20`, `content: 15`,
`performance: 15`, `agent: 10`. **Missing components are dropped and the
rest renormalized** — no PSI key means `performance` is excluded, not
scored as zero. Returns `null` if nothing scoreable ran.

## Testing

Unit tests per check (mocked fetcher/PSI/LLM/subprocess), the SEO rubric's
exact bands as pure-function cases, deltas as pure functions, the
orchestrator's isolation/skip/chain decisions with mocked checks, the
controller's scope pass-through, and the scheduler's interval-vs-manual
branching. No live end-to-end run yet — that step (against a real domain,
temp rows deleted afterward, plus confirming the scheduler's
completion-time semantics across one real re-schedule) is still open.
