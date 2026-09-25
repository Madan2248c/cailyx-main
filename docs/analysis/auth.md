# Auth / Login Module — Analysis & DB Spec

Status: **DB schema pending final approval.** Nothing built yet.

## Scope

DB schema only, for: admin login, client POC login, client team-member login,
role/permission gating, per-client feature toggles, invite-by-admin +
magic-link onboarding, resend, and instant access revocation.

Explicitly out of scope for this pass: Day-1 report, email delivery
provider, actual feature list.

## Decisions already made (confirmed with user)

- **DB**: Postgres (Supabase-hosted, via `DATABASE_URL` in `backend/.env`).
- **ORM**: Prisma.
- **Roles**: fixed enum (`Role`), not a dynamic table — the list of roles
  itself doesn't change at runtime, only what each role can *do*. Adding a
  new role later means adding an enum value + a migration, which is a small,
  ordinary change, not something clients do themselves.
  - No `SUPER_ADMIN` — spec says admins are only ever created by someone with
    DB access (seed/direct insert), so there's one flat admin tier.
- **Permissions**: a separate `permissions` + `role_permissions` table,
  keyed off the `Role` enum (not a roles table). This is the part that stays
  flexible — a role's capabilities can be changed by editing rows, no schema
  change, no redeploy. If a future role needs new permissions or a role
  needs to lose one, that's a data change.
- **Sessions**: hybrid — short-lived JWT access token (5–15 min, verified
  locally on every request, no DB hit) + a `refresh_tokens` table in Postgres
  for rotation and revocation. Revoking a session = mark the row
  `revoked_at`; the access token dies naturally within minutes, the refresh
  token dies immediately.
- **Soft deletes everywhere**: every table gets a nullable `deleted_at`.
  Nothing is ever hard-deleted. Uniqueness constraints (email, tokens,
  client+feature) are implemented as **partial unique indexes**
  (`WHERE deleted_at IS NULL`) via a hand-written migration, since Prisma's
  schema DSL can't express partial indexes directly — this is what lets an
  email be re-invited after a soft-deleted user record.
- **`SUSPENDED`/`DISABLED` vs. `deleted_at`**: status flags are reversible
  business decisions an admin can flip back (pause a client, disable a user
  who'll return); `deleted_at` means fully offboarded, not meant to come back
  through the app.
- **Exactly one active POC per client**: a partial unique index on `users`
  enforces at most one non-deleted, non-`DISABLED` row with `role=CLIENT_POC`
  per `client_id`. Replacing a POC = disable the old one, invite the new one.
- **Multiple concurrent sessions allowed**: each login creates its own
  `refresh_tokens` row; logging in on a new device doesn't kill old sessions.
  Disabling a user (or suspending their client) revokes *all* of their
  non-expired refresh tokens at once.
- **Self-service "Forgot password"** uses the same `auth_tokens` table as
  admin-triggered resends, `type=PASSWORD_RESET`, just user-initiated
  (`created_by = null`) instead of admin-initiated.
- **Login lockout**: `users` gets `failed_attempts` (int, default 0) and
  `locked_until` (timestamptz, nullable). 5 consecutive failures locks the
  account for 15 minutes; a successful login resets `failed_attempts` to 0.
- **Password hashing**: argon2id.
- **Token lifetimes**: access JWT 15 min · refresh token 30 days ·
  invite/resend link 72h · password-reset link 1h.
- **First admin bootstrap**: a one-off seed script that reads credentials
  from env vars and inserts the first `ADMIN` row directly — not a UI flow,
  consistent with "admins can only be added by someone with DB access."

## Tables

### `clients`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| name | text | |
| status | enum `ClientStatus` (`ACTIVE`, `SUSPENDED`) | admin flips this to fully cut off a client, independent of any single user's status |
| created_by | uuid fk → users.id | the admin who created it |
| created_at / updated_at / deleted_at | timestamptz | |

### `permissions`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| key | text | e.g. `manage_team`, `manage_roles`, `manage_client_settings` — catalog grows as future modules add their own permission keys |
| description | text | |
| created_at | timestamptz | this is a code-owned catalog (seeded, not user-editable), so no `updated_at`/`deleted_at` — permissions are added by shipping code, not deleted at runtime |

### `role_permissions`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| role | enum `Role` (`ADMIN`, `CLIENT_POC`, `CLIENT_MEMBER`) | not a foreign key — the enum value itself, since roles are fixed |
| permission_id | uuid fk → permissions.id | |
| created_at / deleted_at | timestamptz | soft-deleting a row here = revoking that permission from the role; partial-unique on `(role, permission_id)` where `deleted_at IS NULL` |

### `users`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| email | citext | partial-unique on `deleted_at IS NULL` |
| password_hash | text, nullable | null until the user completes onboarding via magic link |
| role | enum `Role` (`ADMIN`, `CLIENT_POC`, `CLIENT_MEMBER`) | new roles = new enum value + migration, an ordinary code change |
| client_id | uuid fk → clients.id, nullable | DB `CHECK`: null iff `role = 'ADMIN'`, required otherwise — expressible directly since role now lives on this same row |
| status | enum `UserStatus` (`INVITED`, `ACTIVE`, `DISABLED`) | admin/POC can flip to `DISABLED` without deleting the row |
| invited_by | uuid fk → users.id, nullable | admin (for POC) or POC (for team members) |
| failed_attempts | int, default 0 | reset to 0 on successful login |
| locked_until | timestamptz, nullable | set on the 5th consecutive failure, +15 min |
| last_login_at | timestamptz, nullable | |
| created_at / updated_at / deleted_at | timestamptz | partial-unique on `(client_id)` where `role='CLIENT_POC' AND status<>'DISABLED' AND deleted_at IS NULL` — enforces one active POC per client |

### `client_feature_flags`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| client_id | uuid fk → clients.id | |
| feature_key | text | free-form key for now, no feature enum yet (out of scope) |
| enabled | boolean, default true | |
| updated_by | uuid fk → users.id, nullable | admin who last toggled it |
| created_at / updated_at / deleted_at | timestamptz | partial-unique on `(client_id, feature_key)` where `deleted_at IS NULL` |

### `auth_tokens` (invite / resend / password-reset — the "magic link")
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid fk → users.id | |
| token_hash | text | raw token is emailed, only the hash is stored; partial-unique on `deleted_at IS NULL` |
| type | enum `AuthTokenType` (`INITIAL_INVITE`, `RESEND_INVITE`, `PASSWORD_RESET`) | |
| expires_at | timestamptz | |
| consumed_at | timestamptz, nullable | set once the link is used |
| created_by | uuid fk → users.id, nullable | admin/POC who triggered it; null for self-service reset |
| created_at / deleted_at | timestamptz | a "resend" soft-deletes the previous unconsumed token for that user so old links stop working |

### `refresh_tokens` (sessions)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid fk → users.id | |
| token_hash | text | partial-unique on `deleted_at IS NULL` |
| user_agent | text, nullable | |
| ip_address | text, nullable | |
| expires_at | timestamptz | |
| revoked_at | timestamptz, nullable | admin "kill this session" or logout sets this |
| replaced_by_id | uuid, nullable, self-fk | rotation chain, so reuse of an old refresh token can be detected |
| created_at / deleted_at | timestamptz | |

## Seeded role → permission grants

`role_permissions` is seeded once, mapping each enum value to its starter
permissions:

| role | starter permissions |
|---|---|
| `ADMIN` | all (platform-wide; in practice the app can just special-case `ADMIN` to bypass permission checks entirely, since it's not client-scoped) |
| `CLIENT_POC` | `manage_team`, `manage_client_settings` |
| `CLIENT_MEMBER` | (none by default) |

Changing what a role can do is a data change (add/soft-delete rows in
`role_permissions`), not a migration. **Adding an entirely new role** (e.g. a
future `CLIENT_ANALYST`) is: add the enum value (1 migration), seed its
`role_permissions` rows — small and ordinary, as intended.

## How the described flows map to this schema

- **Admin creates a client + POC**: insert `clients` row, insert `users` row
  (`role=CLIENT_POC`, `client_id` set, `status=INVITED`, `password_hash=null`),
  insert `auth_tokens` row (`type=INITIAL_INVITE`).
- **POC clicks magic link, sets password**: look up `auth_tokens` by hash,
  check `expires_at`/`consumed_at`, set `users.password_hash`,
  `status=ACTIVE`, mark token `consumed_at`.
- **POC invites a team member**: same as above but `role=CLIENT_MEMBER`,
  `invited_by = poc's user id`.
- **Admin resends a link**: soft-delete (`deleted_at`) any existing unconsumed
  `auth_tokens` for that user, issue a new one.
- **Admin disables one user**: `users.status = DISABLED` — login checks this
  and rejects, and all their `refresh_tokens` get `revoked_at` set.
- **Admin cuts off an entire client**: `clients.status = SUSPENDED` — every
  login/refresh check joins to `clients.status`, so every user under that
  client is locked out instantly without touching each user row; existing
  refresh tokens for that client get bulk-revoked.
- **Everyone shares one login screen**: single `POST /auth/login` checks
  `users` by email regardless of role; `role`'s permissions +
  `client.status` + `user.status` together determine what happens next /
  what's rendered.

## Note on the permission catalog's initial size

For the login module itself I've only seeded `manage_team` and
`manage_client_settings` — enough to make POC-invites-team work. Every
future module will add its own permission keys to this table as it's built;
that's expected and not a schema change.
