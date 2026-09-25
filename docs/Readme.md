# Cailyx API Reference

Backend: NestJS, `http://localhost:3001` in dev. All bodies are JSON.
Auth: `Authorization: Bearer <accessToken>` on protected routes.

Error shape (all endpoints):
```json
{ "message": "string or string[]", "error": "Bad Request", "statusCode": 400 }
```

---

## Auth (`/auth`) — public, self-service

### `POST /auth/login`
Request: `{ "email": string, "password": string }`
Response `200`:
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "opaque-string",
  "user": { "id": "uuid", "email": "a@b.com", "role": "ADMIN|CLIENT_POC|CLIENT_MEMBER", "clientId": "uuid|null", "status": "ACTIVE" }
}
```
Errors: `401` wrong credentials or locked; `403` disabled / not-yet-activated user, or suspended client.

### `POST /auth/refresh`
Request: `{ "refreshToken": string }`
Response `200`: same shape as login (new access + refresh token pair).
Errors: `401` invalid/expired/reused token (reuse revokes every session for that user).

### `POST /auth/logout`
Request: `{ "refreshToken": string }`
Response `200`: `{ "success": true }` — idempotent.

### `POST /auth/accept-invite`
Consumes an invite (or resend) token, sets the password, activates the account, logs in.
Request: `{ "token": string, "password": string (min 8) }`
Response `200`: same shape as login.
Errors: `400` invalid/expired/consumed token; `403` account disabled.

### `POST /auth/accept-invite/validate`
Read-only — does not consume the token. Used by the frontend to decide whether to render the "set your password" form.
Request: `{ "token": string }`
Response `200`: `{ "valid": boolean }`

### `POST /auth/forgot-password`
Request: `{ "email": string }`
Response `200` (always, regardless of whether the email exists — prevents account enumeration):
```json
{ "message": "If that email exists, a reset link has been sent." }
```

### `POST /auth/reset-password`
Request: `{ "token": string, "password": string (min 8) }`
Response `200`: same shape as login. Revokes every existing session for the user.
Errors: `400` invalid/expired/consumed token.

### `POST /auth/reset-password/validate`
Same idea as the invite validator, for reset links.
Request: `{ "token": string }` → Response `200`: `{ "valid": boolean }`

### `GET /auth/me`
Requires `Authorization: Bearer <accessToken>`.
Response `200`: the raw JWT claims — `{ "sub": "uuid", "role": "...", "clientId": "uuid|null", "iat": number, "exp": number }`
Errors: `401` missing/invalid/expired token.

---

## Team management (`/team`) — requires `Authorization` header

### `GET /team/clients` — **ADMIN only**
Response `200`:
```json
[
  { "id": "uuid", "name": "Acme Corp", "status": "ACTIVE|SUSPENDED", "seatLimit": 5, "seatsUsed": 3, "createdAt": "iso-date",
    "poc": { "email": "a@b.com", "status": "INVITED|ACTIVE|DISABLED" } | null }
]
```

### `POST /team/clients` — **ADMIN only**
Creates a client and invites its POC.
Request: `{ "name": string, "pocEmail": string, "seatLimit"?: number }` — `seatLimit` defaults to `1` if omitted (min `1`; counts the POC as a seat).
Response `200`:
```json
{
  "client": { "id": "uuid", "name": "...", "status": "ACTIVE", "seatLimit": 1, "createdBy": "uuid", "createdAt": "...", "updatedAt": "...", "deletedAt": null },
  "poc": { "id": "uuid", "email": "...", "role": "CLIENT_POC", "clientId": "uuid", "status": "INVITED" }
}
```

### `PATCH /team/clients/:id/suspend` / `/activate` — **ADMIN only**
No body. Response `200`: `{ "success": true }`.
Suspend immediately bulk-revokes every active session for that client's users.
Errors: `404` client not found.

### `PATCH /team/clients/:id/seats` — **ADMIN only**
Changes a client's seat limit. Doesn't retroactively remove anyone if lowered below current usage.
Request: `{ "seatLimit": number }` (min `1`)
Response `200`: `{ "success": true }`
Errors: `404` client not found; `400` `seatLimit < 1`.

### `GET /team/members` — requires `manage_team` permission
Lists every user in the caller's own client (including the caller), plus seat usage.
Response `200`:
```json
{
  "seatLimit": 5,
  "seatsUsed": 3,
  "members": [{ "id": "uuid", "email": "a@b.com", "role": "CLIENT_POC|CLIENT_MEMBER", "clientId": "uuid", "status": "INVITED|ACTIVE|DISABLED" }]
}
```

### `POST /team/invite` — requires `manage_team` permission
Invites a `CLIENT_MEMBER` into the caller's own client.
Request: `{ "email": string }`
Response `200`: `{ id, email, role: "CLIENT_MEMBER", clientId, status: "INVITED" }`
Errors: `400` caller has no client context (e.g. an admin hitting this directly), or the client has no free seats (`seatsUsed >= seatLimit`).

### `POST /team/users/:id/resend-invite` — requires `manage_team` permission
No body. Response `200`: `{ "success": true }`.
Errors: `404` user not found; `403` target belongs to a different client (unless caller is ADMIN); `400` target already onboarded.

### `PATCH /team/users/:id/disable` — requires `manage_team` permission
No body. Response `200`: `{ "success": true }`. Revokes the target's active sessions.
Errors: same as resend, plus `400` if targeting your own account.

### `PATCH /team/users/:id/enable` — requires `manage_team` permission
No body. Response `200`: `{ "success": true }`.
Errors: `400` if the target isn't currently disabled.

---

## Projects (`/team/clients/:clientId/projects`) — requires `Authorization` header

See `docs/analysis/projects.md` for design rationale. A project belongs to
exactly one client; everything about it beyond name/domain is inferred by
later pipeline modules, not this one.

### `POST /team/clients/:clientId/projects` — **ADMIN only**
Creates a project under a client.
Request: `{ "name": string, "domain": string }`
Response `201`: `{ id, clientId, name, domain: "<normalized>", createdAt }`
Domain is normalized before storage/lookup: lowercase, strip `http(s)://`
and `www.`, keep only the hostname, drop a trailing `.`/`/`.
Errors: `404` client not found; `400` domain already active for this client
(one client can't have two active projects on the same normalized domain).

### `GET /team/clients/:clientId/projects` — ADMIN, or requires `view_projects` permission scoped to own client
Lists the client's non-deleted projects, newest first.
Response `200`: `[{ id, clientId, name, domain, createdAt }]`
Errors: `404` client not found; `403` caller's `clientId` doesn't match (non-admin only).

### `PATCH /team/clients/:clientId/projects/:id/archive` — **ADMIN only**
Soft-deletes a project. No body. Response `200`: `{ "success": true }`.
Its domain becomes reusable for a new project under the same client.
Errors: `404` project not found (wrong client, already archived, or doesn't exist).

---

## Discovery / company context — requires `Authorization` header

See `docs/analysis/discovery.md` for the design and
`backend/src/modules/discovery/README.md` for operational notes. Given a
project, this module crawls its site and produces an evidence-backed
company-context profile. It is **stage 1 of the Day-1 pipeline** and has no
client-facing trigger — a run starts automatically when an admin creates a
project, and nothing is shown to the client until the report module exists.
These endpoints are for staff inspection.

### `POST /team/clients/:clientId/projects/:projectId/discovery-runs` — **ADMIN only**
Queues discovery for the project. No body.
**Resumes** the project's unfinished run when there is one (`PAUSED` or
`FAILED`) — it already holds the fetched pages and extracted facts, so a second
run would pay for the whole crawl and every LLM call again — and otherwise
creates a new run. This is also the recovery path for a run left `PAUSED`
without a job, which can happen if the process dies in the moment between
pausing a run and queueing its continuation.
Response `202`: the run row being worked on
(`{ id, projectId, status, profileVersion, … }`) — new or resumed.
A run is queued, not executed: the response returns immediately and the
pipeline runs in a background worker. If the job queue is unreachable the run
row is created as `FAILED` with the reason (the trigger never fails silently).
Errors: `404` project not found (wrong client, archived, or doesn't exist).

### `GET /team/clients/:clientId/projects/:projectId/discovery-runs` — requires `view_projects`
This project's run history, newest first (max 20).
Response `200`: `[{ id, status, stage, spent: { pages, requests, chars, elapsedMs }, overallConfidence, overallCompleteness, profileVersion, error, notes[], startedAt, completedAt, createdAt }]`
`status` is one of `QUEUED`, `RUNNING`, `PAUSED`, `COMPLETE`,
`COMPLETE_WITH_GAPS`, `MANUAL_REVIEW_REQUIRED`, `FAILED`. `stage` is the last
**completed** stage — a `PAUSED` run resumes from the stage after it.
Errors: `404` project not found.

### `GET /team/clients/:clientId/discovery-runs/:runId` — requires `view_projects`
One run, including every page it considered.
Response `200`: the run row above, plus
`pages: [{ id, url, pageType, fetchStatus, discoverySource, title, selected, selectionReason, extractStatus, extractError, factCount }]`
and `profileId` (null until the compile stage has produced a profile).
Errors: `404` run not found, or it belongs to another client's project.

### `GET /team/clients/:clientId/projects/:projectId/company-context` — requires `view_projects`
The project's current company-context profile.
Response `200`: `{ id, projectId, discoveryRunId, version, overallConfidence, overallCompleteness, profile, createdAt, updatedAt }`,
where `profile` is the full enriched schema (every material field is an
evidence-bearing object — see the analysis doc). Response `200` with `null`
when no run has produced a profile yet.
Errors: `404` project not found.

### `GET /team/clients/:clientId/projects/:projectId/social-profiles` — requires `view_projects`
The project's discovered social footprints, best-verified first.
Response `200`: `[{ id, platform, url, discoveryMethod, score, verificationStatus, verifiedAt }]`
`discoveryMethod` is `SAMEAS` (JSON-LD `sameAs`), `LINK_SCAN` (an on-site link)
or `SERP` (found by the paid-search fallback sweep). `verificationStatus` is
`VERIFIED` (80–100), `PROBABLE` (60–79), `POSSIBLE` (40–59) or `REJECTED` (<40);
rejected candidates are not stored. Walled platforms (LinkedIn, Instagram,
Facebook, X, TikTok, Threads) are never fetched, so they can never exceed
`PROBABLE` — see the analysis doc for why that ceiling is honest rather than a
limitation to work around.
Errors: `404` project not found.

---

## Roles & permissions

Fixed enum: `ADMIN`, `CLIENT_POC`, `CLIENT_MEMBER`. `ADMIN` implicitly has every
permission (bypasses the permission check entirely). Everyone else's grants
live in the `role_permissions` table — see `docs/analysis/auth.md` and
`backend/prisma/seed.ts`. Currently seeded: `CLIENT_POC` has `manage_team`,
`manage_client_settings`, and `view_projects`; `CLIENT_MEMBER` has
`view_projects`.

## Not yet built

- Any endpoint for `client_feature_flags` (the per-client feature toggle
  table exists in the DB; no read/write API yet).
- Email delivery — invite/reset links are logged to the backend console
  (`Logger.debug`) instead of sent, until an email module exists.
- Swagger/OpenAPI decorators — this file is the source of truth for now.
