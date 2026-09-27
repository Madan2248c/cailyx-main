# Projects module

Small, foundational module: a client can have multiple projects (multiple
domains/brands under one account). Everything downstream — the Day-1
report pipeline and every module after it — keys off a project, not a
client directly.

Admin creates a project by entering **name + domain + Day-1 spend
consent** (plus an optional spend ceiling); everything else about it
(business details, ICP, competitors, etc.) is inferred by later pipeline
modules, not this one. Creating a project starts the Day-1 pipeline
automatically — see `docs/analysis/day1-pipeline.md`.

## Architecture

```
modules/projects/
  projects.module.ts
  controllers/
    projects.controller.ts       # nested under /team/clients/:clientId/projects
    projects.controller.spec.ts
  services/
    projects.service.ts          # domain normalization, scoping, CRUD-ish actions
    projects.service.spec.ts
  dto/
    create-project.dto.ts

prisma/
  schema.prisma (Project model), migrations/  # see docs/analysis/projects.md
```

Reuses `JwtAuthGuard` / `RolesGuard` / `PermissionsGuard` /
`@CurrentUser` / `@Roles` / `@RequirePermission` from `common/` — no new
auth infrastructure.

## Public API

See `docs/Readme.md` for full request/response shapes. Summary:

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/team/clients/:clientId/projects` | ADMIN | `{ name, domain, day1SpendConsent: true, day1SpendCeilingUsd? }` — starts the Day-1 pipeline |
| GET | `/team/clients/:clientId/projects` | ADMIN, or `view_projects` scoped to own client | |
| PATCH | `/team/clients/:clientId/projects/:id/archive` | ADMIN | soft delete |
| GET | `/team/clients/:clientId/projects/:id/day1` | ADMIN | pipeline status (recovery ops) |
| POST | `/team/clients/:clientId/projects/:id/day1/retry` | ADMIN | re-enqueue a stalled/failed pipeline |

## Dependencies

- **Modules**: `PrismaModule` (global), `Day1PipelineModule` (project
  creation starts the pipeline), auth module's guards/decorators from
  `common/`.
- **New permission**: `view_projects`, seeded onto `CLIENT_POC` and
  `CLIENT_MEMBER` (see `prisma/seed.ts`) — re-run `npm run db:seed` after
  pulling this module if your DB doesn't have it yet.

## Domain normalization

Applied once in `ProjectsService` before every insert/lookup (see
`docs/analysis/projects.md` for the full rationale): lowercase, strip a
leading `http(s)://` and `www.`, keep only the hostname (drop path/query/
fragment), drop a trailing `.`/`/`. `https://WWW.Acme.com/pricing` and
`acme.com` both normalize to `acme.com`.

## Consumers

None yet. Future pipeline modules (Company-Context, Technical Audit, AEO,
Competitor Analysis, Day-1 report synthesis) will each take a `projectId`
as their unit of work.

## PRD alignment

| Requirement | Status | Notes |
|---|---|---|
| Client can have multiple projects (domains/brands) | ✅ | `Project.clientId`, no cardinality limit. |
| Admin creates project with name + domain only | ✅ | Plus Day-1 spend consent (+ optional ceiling). Everything else deferred to pipeline modules. |
| One active domain per client | ✅ | Partial unique index `(client_id, domain)` WHERE `deleted_at IS NULL`. |
| POC/member can view their own client's projects | ✅ | `view_projects` permission, scoped in `ProjectsService.assertCanView`. |
| Soft deletes throughout | ✅ | "Archive" = `deletedAt` set; no hard deletes. |

## Testing notes

**Automated (unit) tests**: `npm run test` — 11 new tests
(`projects.service.spec.ts`, `projects.controller.spec.ts`), same style as
the auth module (`@nestjs/testing` + mocked `PrismaService`, guards
overridden via `overrideGuard()`).

Verified manually end-to-end against the live Supabase instance, test rows
deleted afterward:

- Created a client, created a project with `https://WWW.Acme-Test.com/pricing`
  as the domain, confirmed it was stored normalized as `acme-test.com`.
- Confirmed creating a second project on the same (normalized) domain
  under the same client is rejected with `400`.
- Listed the client's projects as ADMIN and as that client's own POC —
  both succeeded.
- Confirmed a second client's POC gets `403` listing the first client's
  projects, and `403` attempting to create one there (`RolesGuard`, since
  project creation is admin-only).
- Archived a project, confirmed it disappears from the list, then
  confirmed a new project could be created on the same now-freed domain.
