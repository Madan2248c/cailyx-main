# Changelog

Running record of what shipped, how it was verified, and what it left for
later. Newest first.

## 2026-09-25 — Auth module: per-client seat limits

`clients.seat_limit` (integer, default 1, `CHECK >= 1`), counting the POC as
a seat. Enforced in `TeamService.inviteTeamMember` (rejects with `400` when
`seatsUsed >= seatLimit`); admin-adjustable via `PATCH /team/clients/:id/seats`.
`GET /team/clients` and `GET /team/members` now both report `seatLimit` +
`seatsUsed`. This is auth-module *configuration*, deliberately distinct from
the deferred per-client product-feature toggles (see "every feature is a
plugin" in `docs/context.md`, added the same day) — seats are an auth-module
concern, not a feature flag.

Frontend: `CreateClientDialog` gained a seat-limit input (default 1); new
`EditSeatsDialog` for admins to change it later; `/admin/clients` shows
"X / Y seats" per client; `/team` shows the POC's own usage and hides the
invite button once at the limit.

5 new/updated unit tests (87 total). Verified live end-to-end through the
actual `/api/team/*` Next.js proxy (not just the backend directly): created
a client at `seatLimit=1`, confirmed the 1st team-member invite succeeds and
the 2nd is rejected, confirmed an admin raising the limit immediately
unblocks further invites, confirmed `seatLimit=0` is rejected by validation.

## 2026-09-25 — Login module complete

**DB**: 7 tables (`clients`, `users`, `permissions`, `role_permissions`,
`client_feature_flags`, `auth_tokens`, `refresh_tokens`), all soft-deletable.
Fixed `Role` enum with permissions as data (`role_permissions`), a partial
unique index enforcing exactly one active POC per client, and a `CHECK`
constraint tying `client_id` nullability to role. Full rationale in
`docs/analysis/auth.md`.

**Backend**: Prisma + `@prisma/adapter-pg` wired into NestJS following the
official docs pattern. Two controllers:
- `AuthController` — login, refresh (with rotation + reuse-detection that
  revokes the whole session chain), logout, accept-invite, forgot/reset
  password, `/me`, plus `*/validate` read-only token checks.
- `TeamController` — admin creates clients + invites POCs, POC invites/
  manages their own team, admin suspends/activates clients. Guarded by a
  `RolesGuard` (hardcoded, for platform-level actions) and a
  `PermissionsGuard` (checks `role_permissions` in the DB, so future roles
  inherit access purely by being granted a permission).

argon2id hashing, JWT access tokens (15 min) + opaque DB-backed refresh
tokens (30 days), 5-attempt/15-min lockout. Verified end-to-end against the
live Supabase instance repeatedly — see module README for the full test
list.

**Frontend**: Next.js App Router, shadcn/ui (Base UI variant). BFF pattern —
`/api/auth/*` and `/api/team/*` route handlers proxy to the backend
server-side; the refresh token lives only in an `httpOnly` cookie, never in
client JS. Pages: `/login`, `/accept-invite`, `/forgot-password`,
`/reset-password`, `/dashboard`, `/admin/clients`, `/team`.

**Bugs found and fixed during manual testing**:
- Reusing an already-consumed invite/reset link still rendered the
  password-setting form (only failed on submit). Added
  `/auth/*/validate` endpoints and check them server-side before rendering.
- `<Button render={<Link/>}>` triggered a Base UI console error — `Link`
  renders an `<a>`, not a `<button>`; needed `nativeButton={false}`.

**Known gaps, deferred on purpose**:
- No email sending — invite/reset links are logged to the console.
  Plunk credentials are in `.env` but sending fails without a verified
  sender configured in the Plunk dashboard.
- No UI/API for `client_feature_flags` (table exists, nothing reads/writes
  it yet).
- No Swagger/OpenAPI decorators — `docs/Readme.md` is the API reference for
  now.
- No HTTP-level e2e tests — see the unit test suite added below for what
  *is* covered.

## 2026-09-25 — Auth module unit tests

82 tests across 10 spec files (`npm run test`), following
[NestJS's testing docs](https://docs.nestjs.com/fundamentals/testing):
`Test.createTestingModule` with mocked `PrismaService` (shared factory in
`test/mocks/prisma.mock.ts`) / `PasswordService` / `TokenService` /
`ConfigService`. Covers `AuthService`, `TeamService` (including cross-tenant
scoping and self-action guards), the three guards, and both controllers
(delegation only — guards overridden via `overrideGuard()` since
`TestingModule.compile()` eagerly instantiates classes named in
`@UseGuards`). `PasswordService`'s tests run real argon2 hashing, no mocks.

Still no HTTP-level e2e tests exercising the real request pipeline
(validation pipes, guards actually running) — these are unit tests only.
