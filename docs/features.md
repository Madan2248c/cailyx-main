# Module status

Living doc — update whenever a module starts, finishes, or its scope
changes. One module built at a time, end-to-end (DB → backend → frontend)
before the next one starts, per AGENTS.md.

| Module | Status | DB | Backend | Frontend | Notes |
|---|---|---|---|---|---|
| Login / access control | ✅ Done | ✅ | ✅ | ✅ | See `backend/src/modules/auth/README.md` for full detail. |
| Projects | ✅ Done | ✅ | ✅ | ✅ | See `backend/src/modules/projects/README.md`. Foundational — a client can have multiple projects; the Day-1 report pipeline keys off a project, not a client. |
| Discovery / company context | ✅ Done | ✅ | ✅ | n/a | Stage 1 of the Day-1 pipeline. `backend/src/modules/discovery/README.md` + `docs/analysis/discovery.md`. Backend-only by design: it has no client-facing trigger or UI — a run starts when an admin creates a project, and the client sees nothing until the report module exists. |
| Technical Audit | ✅ Done | ✅ | ✅ | n/a | Stage 2 of the Day-1 pipeline. `backend/src/modules/technical-audit/README.md` + `docs/analysis/technical-audit.md`. 8 checks → composite → deltas → narrative; BullMQ queue (concurrency 1) + WEEKLY/MONTHLY schedules. Backend-only like Discovery: no UI until the report module exists. Live end-to-end run passed 2026-09-26 vs resend.com (COMPLETE, score 86, 982 sitemap entries, temp rows cleaned). |
| Social Activity | ✅ Done | ✅ | ✅ | n/a | Stage 3 of the Day-1 pipeline. `backend/src/modules/social-activity/README.md` + `docs/analysis/digital-presence-audit.md`. Verified-profile pulls via Apify (dual spend gates) → 30-day cadence aggregates → dormant/infrequent findings; BullMQ queue (concurrency 1) + WEEKLY default schedules. Backend-only like Discovery: no UI until the report module exists. Live end-to-end run passed 2026-09-26 vs Fello/fello.ai (COMPLETE in 184s, $0.01 spend, all 4 default platforms with real data, temp rows cleaned). |
| Query Set (SOP-1) | ✅ Done (live run open) | ✅ | ✅ | n/a | Not a Day-1 pipeline stage — a project's versioned prompt set, consumed later by `measurement`/AEO Audit. `backend/src/modules/query-set/README.md` + `docs/analysis/query-set.md`. Two-step LLM generation (propose per-project buckets grounded in Discovery's CompanyContextProfile → generate prompts per bucket), bounded by deterministic code-enforced guardrails (4–14 buckets, 5–40 prompts/bucket, ≥70% unbranded, rationale-grounding rejection). Manual CRUD on drafts; immutable once active, `fork()` for the next version. Backend-only: no client UI yet. Live end-to-end run against a real project (with a real CompanyContextProfile) still open. |
| Day-1 report | Not started | — | — | — | Explicitly deferred while building login and projects. |
| Per-client feature config | Not started | ⚠️ (placeholder table) | ❌ | ❌ | Intentionally not building generic toggle infra ahead of a real feature — see "every feature is a plugin" in `docs/context.md`. The existing `client_feature_flags` table is a simple boolean placeholder from the login module and will likely be redesigned (per-feature config, not just on/off) once the first real feature module needs it. |
| Email delivery | Not started | — | — | — | Plunk credentials added to `.env` but unused — sending fails without a verified sender domain configured in the Plunk dashboard. Invite/reset links are logged to the console in the meantime. |

## Login module — requirement-level detail

| Requirement | Status | Notes |
|---|---|---|
| Invite-only, no self-signup | ✅ | |
| One shared login screen for all roles | ✅ | |
| Role/permission-gated access | ✅ | Enum role + `role_permissions` table; see `docs/analysis/auth.md`. |
| Admin creates client + invites POC | ✅ | `POST /team/clients` |
| POC sets password via magic link, onboards | ✅ | `POST /auth/accept-invite` |
| POC can add their own team | ✅ | `POST /team/invite` |
| Admin can resend invite links | ✅ | also usable by POC for their own team |
| Admin can disable/suspend a client entirely | ✅ | `PATCH /team/clients/:id/suspend` |
| Admin can turn features on/off per client | ⚠️ | Deliberately deferred — see "every feature is a plugin" in `docs/context.md`. Placeholder table exists but no endpoints; will likely be redesigned once a real feature needs per-client config, not just on/off. |
| Admins only added via DB access | ✅ | no admin-creation endpoint exists by design |
| Per-client seat limit (POC + members) | ✅ | Added 2026-09-25. `clients.seat_limit`, default 1, admin-adjustable via `PATCH /team/clients/:id/seats`. This is auth-module config, not a product feature flag — see `docs/context.md`. |
| Soft deletes everywhere | ✅ | |
| Email actually sent (vs. logged) | ❌ | blocked on Plunk sender verification |

## Projects module — requirement-level detail

| Requirement | Status | Notes |
|---|---|---|
| Client can have multiple projects (domains/brands) | ✅ | `Project.clientId`, no cardinality limit |
| Admin creates project with name + domain only | ✅ | `POST /team/clients/:clientId/projects` |
| One active domain per client | ✅ | Partial unique index, domain normalized at the app layer |
| POC/member can view their own client's projects | ✅ | New `view_projects` permission |
| Soft deletes | ✅ | "Archive" = `deletedAt` |

## Discovery / company-context module — requirement-level detail

| Requirement | Status | Notes |
|---|---|---|
| Runs automatically when a project is created | ✅ | `ProjectsService.createProject` → `DiscoveryService.startRun`, same request |
| Resumable, budgeted, long-running (not one HTTP call) | ✅ | BullMQ `discovery` queue; a run pauses on the elapsed budget and re-enqueues a continuation for the same run |
| Evidence-bearing output (every claim traceable to a quote) | ✅ | The spec doc's field format: value + fact type + confidence + evidence quotes with source URL and fetch date |
| Anti-hallucination: claims checked against their source | ✅ | Two independent checks — a deterministic verbatim-substring check, then an LLM verification pass that can only remove or penalise |
| External facts never equal to first-party | ✅ | Capped at 0.6 confidence, marked `external`, validated the same way |
| Social profiles discovered + verified | ✅ | Same-site crawl first, SERP fallback only for what's still missing, then our own point-table scoring |
| Paid search cannot be spent by accident | ✅ | `SWARM_ALLOW_LIVE` must be `1`; `PRESENCE_SERP_MAX_QUERIES` caps a sweep; all caps cumulative across re-enqueues |
| Definition-of-Done gates | ✅ | Identity confidence < 0.80 → `MANUAL_REVIEW_REQUIRED`; < 80% of fetched pages analyzed → `COMPLETE_WITH_GAPS` |
| Client-facing UI / trigger | n/a by design | Nothing is shown to the client until the Day-1 report module exists |

## Technical Audit module — requirement-level detail

| Requirement | Status | Notes |
|---|---|---|
| 8 checks sequential (robots → cdn → sitemap → js-render → cwv → schema → agent-readiness → page-inventory) | ✅ | Per-check isolation: a throw becomes an `error` finding, never aborts the run |
| Page inventory skipped (not-run) with no sitemap | ✅ | "Cannot enumerate" is not "pages are bad" — no double-counting the sitemap finding |
| Composite 0-100, renormalized over what ran | ✅ | Missing components dropped, not zeroed; `null` when nothing scoreable ran |
| Run-over-run deltas (16 metrics) + page churn | ✅ | Pure functions; previous resolved before persist; failed priors never baseline |
| LLM narrative via shared LlmService | ✅ | After persistence, never throws, never touches the score |
| BullMQ queue, one job per run, concurrency 1 | ✅ | `technical-audit` queue; terminal rows no-op on retry |
| WEEKLY/MONTHLY schedules, manual trigger | ✅ | `upsertJobScheduler` with `every` interval; `MANUAL_ONLY` removes the recurrence; no concurrent runs per project |
| Client-facing UI / trigger | n/a by design | Nothing is shown to the client until the Day-1 report module exists |
| Live end-to-end run against a real domain | ❌ | Open: run once, confirm scheduler re-schedule semantics, delete temp rows after |

## Known deferred items

- Swagger/OpenAPI decorators on the auth/team controllers.
- HTTP-level e2e tests (`test/app.e2e-spec.ts` still only covers the default
  scaffold route) — unit tests exist (see below) but nothing exercises the
  real NestJS request pipeline (guards, pipes, DTO validation) yet.
- `@nestjs/observe` telemetry still has placeholder `appKey`/`appSecret` in
  `app.module.ts` — logs a harmless 401 on startup, not wired to a real
  account.

## Automated test coverage

Added 2026-09-25: 87 unit tests across 10 spec files for the auth module,
plus 11 more (98 total, 12 spec files) added the same day for the projects
module (`npm run test`), using `@nestjs/testing` with mocked
`PrismaService` — see `backend/src/modules/auth/README.md` and
`backend/src/modules/projects/README.md` for what's covered.
