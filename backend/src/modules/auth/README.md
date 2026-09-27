# Auth module

Handles authentication for every role (admin, client POC, client member)
and the admin/POC-side account management that feeds it: client
onboarding, team invites, and access revocation.

## Architecture

```
modules/auth/
  auth.module.ts              # wires everything below into Nest
  controllers/
    auth.controller.ts        # self-service: login, refresh, logout, invite/reset flows, /me
    auth.controller.spec.ts
    team.controller.ts        # admin/POC-side: clients, invites, disable/enable, suspend/activate
    team.controller.spec.ts
  services/
    auth.service.ts           # session issuance, credential checks, lockout, token consumption
    auth.service.spec.ts
    team.service.ts           # client/user CRUD-ish actions, scoped by role + client
    team.service.spec.ts
    password.service.ts       # argon2id hash/verify
    password.service.spec.ts
    token.service.ts          # opaque tokens (refresh/invite/reset) + JWT signing, TTL config
    token.service.spec.ts
  dto/                        # class-validator request shapes

common/
  guards/jwt-auth.guard.ts       # verifies access token signature/expiry only, no DB hit
  guards/jwt-auth.guard.spec.ts
  guards/roles.guard.ts          # @Roles(...) — hardcoded role check, for platform-level actions
  guards/roles.guard.spec.ts
  guards/permissions.guard.ts    # @RequirePermission(key) — checks role_permissions in the DB; ADMIN bypasses
  guards/permissions.guard.spec.ts
  decorators/current-user.decorator.ts
  jwt/global-jwt.module.ts       # makes JwtService available app-wide

prisma/
  schema.prisma, migrations/  # see docs/analysis/auth.md for the full DB design rationale
  seed.ts                     # seeds the permission catalog + starter role grants (`npm run db:seed`)

test/mocks/prisma.mock.ts     # shared PrismaService mock factory, used by every *.service.spec.ts and *.guard.spec.ts above
```

## Public API

See `docs/Readme.md` for full request/response shapes. Summary:

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/login` | none | |
| POST | `/auth/refresh` | none (refresh token in body) | rotates; reuse of a revoked token kills all sessions |
| POST | `/auth/logout` | none | |
| POST | `/auth/accept-invite` | none (invite token in body) | |
| POST | `/auth/accept-invite/validate` | none | read-only, doesn't consume |
| POST | `/auth/forgot-password` | none | always generic response |
| POST | `/auth/reset-password` | none (reset token in body) | revokes all existing sessions |
| POST | `/auth/reset-password/validate` | none | read-only, doesn't consume |
| GET | `/auth/me` | access token | |
| GET | `/team/clients` | access token, ADMIN | |
| POST | `/team/clients` | access token, ADMIN | creates client + invites POC |
| PATCH | `/team/clients/:id/suspend` \| `/activate` | access token, ADMIN | |
| PATCH | `/team/clients/:id/seats` | access token, ADMIN | changes seat_limit |
| GET | `/team/members` | access token, `manage_team` | scoped to caller's client, includes seat usage |
| POST | `/team/invite` | access token, `manage_team` | rejected with 400 if the client has no free seats |
| POST | `/team/users/:id/resend-invite` | access token, `manage_team` | |
| PATCH | `/team/users/:id/disable` \| `/enable` | access token, `manage_team` | |

## Dependencies

- **Modules**: `PrismaModule` (global), `GlobalJwtModule` (global), `ConfigModule`, `EmailModule` (leaf — invite/reset delivery).
- **npm packages**: `argon2`, `@nestjs/jwt`, `class-validator`, `class-transformer`, `joi`.
- **External services**: Plunk via `EmailService` — invite/resend/reset links are emailed; when email is unconfigured the token is `Logger.debug`-logged instead (dev path).

## Environment variables

| Name | Default | Description |
|---|---|---|
| `JWT_ACCESS_SECRET` | — (required) | Signs access tokens. Must be ≥32 chars. |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | Access token lifetime. |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Refresh token lifetime. |
| `INVITE_TOKEN_TTL_HOURS` | `72` | Invite/resend link lifetime. |
| `RESET_TOKEN_TTL_HOURS` | `1` | Password-reset link lifetime. |
| `LOGIN_MAX_ATTEMPTS` | `5` | Failed logins before lockout. |
| `LOGIN_LOCKOUT_MINUTES` | `15` | Lockout duration. |
| `FRONTEND_URL` | `http://localhost:3000` | Base URL emailed invite/reset links point at (`/accept-invite?token=…`, `/reset-password?token=…`). |

## Consumers

None yet — this is the first module. Everything downstream that needs to
know who's logged in will depend on `JwtAuthGuard` / `CurrentUser` from
`common/`.

## PRD alignment

| Requirement | Status | Notes |
|---|---|---|
| Invite-only access, no self-signup | ✅ | Users are only ever created via admin/POC actions or the DB seed. |
| Shared login screen, role/permission-gated | ✅ | `POST /auth/login` is role-agnostic; `RolesGuard`/`PermissionsGuard` gate everything downstream. |
| Admin can toggle a client's feature access | ⚠️ | `client_feature_flags` table exists in the DB design; no read/write endpoints built yet — deferred until an actual feature list exists. |
| Admin can fully suspend a client | ✅ | `PATCH /team/clients/:id/suspend`, bulk-revokes sessions. |
| Per-client seat limit (POC + members) | ✅ | Added 2026-09-25. `clients.seat_limit` (default 1, includes the POC), enforced in `inviteTeamMember`, admin-adjustable via `PATCH /team/clients/:id/seats`. This is auth-module *configuration*, distinct from the deferred product-feature toggles — see `docs/context.md`. |
| Admins only addable via DB access | ✅ | No admin-creation endpoint exists; bootstrapped by direct insert. |
| Admin adds client POC, sends magic link | ✅ | `POST /team/clients`; delivered by email (Plunk), debug-logged only when email is unconfigured. |
| POC can add their own team | ✅ | `POST /team/invite`, permission-gated. |
| Admin can resend links ̦| ✅ | `POST /team/users/:id/resend-invite` (also usable by POC for their own team). |
| Soft deletes throughout | ✅ | Every table has `deleted_at`; nothing is hard-deleted. |
| Swagger/OpenAPI decorators | ❌ | Not wired up yet — deferred, `docs/Readme.md` is the source of truth for now. |

## Testing notes

**Automated (unit) tests**: `npm run test` — 87 tests across 10 spec files,
using `@nestjs/testing`'s `Test.createTestingModule` with mocked
`PrismaService`/`PasswordService`/`TokenService`/`ConfigService` (see
`test/mocks/prisma.mock.ts`). Covers every branch of `AuthService` and
`TeamService` (lockout, token reuse/expiry, cross-tenant scoping,
self-action guards), the three guards (`JwtAuthGuard`, `RolesGuard`,
`PermissionsGuard`), and both controllers (delegation to the right service
method with the right args — guards overridden via `overrideGuard()` since
`TestingModule.compile()` eagerly instantiates classes named in
`@UseGuards`, per the NestJS testing docs). `test/app.e2e-spec.ts` still
only covers the default scaffold route — no HTTP-level e2e tests yet.

Everything below was additionally verified manually against the live
Supabase instance, end-to-end, with test rows deleted afterward — this
is the level unit tests with mocked Prisma can't reach (real constraints,
real Postgres behavior, the actual frontend):

- Full onboarding loop: admin creates client+POC → POC accepts invite → POC
  invites a team member → resend/disable/enable.
- Login: correct/incorrect password, 5-failed-attempt lockout, disabled
  user, invited (not yet onboarded) user, suspended client — each rejected
  with the right status/message.
- Refresh rotation; reusing an already-rotated token revokes the entire
  session chain (confirmed the newly-issued token died too).
- Forgot/reset password: generic response regardless of email existing,
  old password stops working, new one works, prior sessions revoked.
- Cross-tenant isolation: one client's POC gets 403 acting on another
  client's user, and 403 hitting admin-only routes.
- Seat limits: created a client with `seatLimit=2`, confirmed the 2nd
  invite (POC + 1 member) succeeds and the 3rd is rejected with `400`;
  confirmed an admin raising the limit via `PATCH .../seats` immediately
  unblocks further invites; confirmed `0` is rejected by DTO validation.
  Verified through the actual Next.js `/api/team/*` proxy layer too, not
  just the backend directly.
- Invite/reset link reuse: confirmed the backend rejects a second use
  (`400`), and that the frontend now pre-checks validity via
  `/validate` before rendering the form, instead of only failing on submit.
- Frontend BFF cookie flow: confirmed via cookie-jar curl that the raw
  refresh token never appears in a JSON response body, only as an
  `HttpOnly` cookie.
