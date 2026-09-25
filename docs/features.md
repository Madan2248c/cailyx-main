# Module status

Living doc — update whenever a module starts, finishes, or its scope
changes. One module built at a time, end-to-end (DB → backend → frontend)
before the next one starts, per AGENTS.md.

| Module | Status | DB | Backend | Frontend | Notes |
|---|---|---|---|---|---|
| Login / access control | ✅ Done | ✅ | ✅ | ✅ | See `backend/src/modules/auth/README.md` for full detail. |
| Day-1 report | Not started | — | — | — | Explicitly deferred while building login. |
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

## Known deferred items

- Swagger/OpenAPI decorators on the auth/team controllers.
- HTTP-level e2e tests (`test/app.e2e-spec.ts` still only covers the default
  scaffold route) — unit tests exist (see below) but nothing exercises the
  real NestJS request pipeline (guards, pipes, DTO validation) yet.
- `@nestjs/observe` telemetry still has placeholder `appKey`/`appSecret` in
  `app.module.ts` — logs a harmless 401 on startup, not wired to a real
  account.

## Automated test coverage

Added 2026-09-25: 87 unit tests across 10 spec files for the auth module
(`npm run test`), using `@nestjs/testing` with mocked `PrismaService` — see
`backend/src/modules/auth/README.md` for what's covered.
