# Projects Module — Analysis

Status: **DB schema pending final approval.** Nothing built yet.

## Scope

A minimal, foundational module: a `Client` can have multiple `Project`s
(multiple domains/brands under one account). Admin creates a project under
a client by entering **name + domain only**. Everything else about a
project (business details, ICP, competitors, etc.) is inferred by later
pipeline modules (Company-Context, Technical Audit, AEO, Competitor
Analysis, Day-1 report synthesis, etc.) — explicitly out of scope here.

This module exists because the Day-1 report pipeline, and everything after
it, keys off a *project*, not a *client* directly (confirmed with user).
`docs/context.md`'s module-ordering plan calls out "projects" by name as
required shared infrastructure that must exist before feature modules are
built.

## Decisions

- **Ownership**: a project belongs to exactly one client (`clientId`, not
  nullable) and optionally records which admin created it (`createdBy`,
  nullable — same nullable-FK-to-`users` pattern as `clients.created_by`).
- **Soft deletes**: `deletedAt`, same as every other table. "Archiving" a
  project is a soft delete — there's no separate `status` enum. Unlike
  clients (which have a *reversible* `ACTIVE`/`SUSPENDED` toggle because a
  suspended client's users must be locked out of login instantly), a
  project has no login/access behavior riding on its state — archiving one
  just hides it from active lists. If a real need for a reversible
  "paused" state shows up once the pipeline exists, it can be added as its
  own field then; not guessing that shape now.
- **Domain uniqueness**: a partial unique index on `(client_id, domain)`
  WHERE `deleted_at IS NULL` — same pattern as every other partial index in
  this codebase (see `docs/analysis/auth.md`). One client shouldn't run two
  active projects against the same domain, but a domain can be reused after
  its project is archived, and the same domain can appear under two
  *different* clients (e.g. an agency-of-record scenario isn't being ruled
  out at this layer).
- **Domain normalization** (mirrors how `TeamService` normalizes email —
  trim + lowercase before every read/write): applied once in
  `ProjectsService` before insert and before any domain-based lookup —
  1. trim whitespace
  2. lowercase
  3. strip a leading `http://` or `https://` scheme
  4. strip a leading `www.`
  5. strip everything from the first `/`, `?`, or `#` onward (path/query/
     fragment) — only the hostname is kept
  6. strip a trailing `.` or `/` if any survived

  `https://WWW.Acme.com/pricing` and `acme.com` both normalize to
  `acme.com`. Rejects (via DTO validation, `@Matches`) anything that after
  normalization isn't a plausible hostname (must contain at least one `.`,
  no whitespace, no `@`) — good enough to catch obvious garbage without
  building a full public-suffix-list validator for a field the pipeline
  will crawl anyway (a genuinely bad domain fails loudly there).

- **Who can create a project**: **admin-only** — matches the excalidraw
  diagram, where only the Admin swimlane creates clients and projects.
  Enforced with `@Roles(Role.ADMIN)`, same as `POST /team/clients`.
- **Who can list a client's projects**: admin (any client), plus that
  client's own POC/members (their own client's projects only, read-only).
  Reasoning: a POC/member should be able to see what projects exist under
  their own account even though they can't create one — this is the same
  shape as `GET /team/members` (self-service visibility, no ability to
  mutate). Implemented with a new permission key, `view_projects`, seeded
  onto both `CLIENT_POC` and `CLIENT_MEMBER` (unlike `manage_team`, which
  only `CLIENT_POC` gets) — reading your own projects isn't a team-
  management action. `PermissionsGuard` still special-cases `ADMIN` to
  bypass, and the service additionally scopes non-admin callers to their
  own `clientId` (can't pass someone else's `clientId` in the URL and read
  their projects) — same cross-tenant-isolation shape as
  `TeamService.getScopedUser`.
- **Route shape**: nested under the existing `/team/clients/:clientId`
  resource (`POST/GET /team/clients/:clientId/projects`,
  `PATCH /team/clients/:clientId/projects/:id/archive`) rather than a
  top-level `/projects` resource. Clients are already managed under
  `/team`, and every project operation is inherently scoped to a client —
  nesting makes that scoping explicit in the URL instead of requiring a
  `clientId` in the request body, and keeps `TeamController`'s existing
  admin/POC-split pattern (`@Roles` vs `@RequirePermission`) directly
  reusable. A dedicated top-level `/projects` resource can be introduced
  later if the pipeline modules need project-scoped routes that don't
  naturally nest under a client (they can still join through `clientId`).
- **No project-level status beyond soft-delete** for this pass — see
  "Soft deletes" above.

## Table

### `projects`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| client_id | uuid fk → clients.id | not nullable |
| name | text | |
| domain | text | normalized (see above) before every write/lookup |
| created_by | uuid fk → users.id, nullable | the admin who created it |
| created_at / updated_at / deleted_at | timestamptz | |

Partial unique index `(client_id, domain)` WHERE `deleted_at IS NULL`,
added via a hand-written follow-up migration (same as every other partial
index in this codebase — Prisma's schema DSL can't express these
directly).

## New permission

| key | description | seeded to |
|---|---|---|
| `view_projects` | View the caller's own client's projects. | `CLIENT_POC`, `CLIENT_MEMBER` |

`ADMIN` bypasses `PermissionsGuard` entirely, as with every other
permission, so no explicit grant is needed for it.

## Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/team/clients/:clientId/projects` | ADMIN | `{ name, domain }`; 409-equivalent (400) if domain already active for this client |
| GET | `/team/clients/:clientId/projects` | ADMIN, or `view_projects` scoped to own client | list, newest first |
| PATCH | `/team/clients/:clientId/projects/:id/archive` | ADMIN | soft delete |

## Open questions resolved as judgment calls (not asked — low-stakes, reversible)

1. Domain normalization rule — decided above; documented so it's easy to
   revisit once the crawler module needs a stricter/different rule.
2. POC/member read access — decided yes, read-only, new `view_projects`
   permission rather than piggybacking on `manage_team`.
3. Extra status beyond soft-delete — decided no, not yet.
