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

## Roles & permissions

Fixed enum: `ADMIN`, `CLIENT_POC`, `CLIENT_MEMBER`. `ADMIN` implicitly has every
permission (bypasses the permission check entirely). Everyone else's grants
live in the `role_permissions` table — see `docs/analysis/auth.md` and
`backend/prisma/seed.ts`. Currently seeded: `CLIENT_POC` has `manage_team`
and `manage_client_settings`.

## Not yet built

- Any endpoint for `client_feature_flags` (the per-client feature toggle
  table exists in the DB; no read/write API yet).
- Email delivery — invite/reset links are logged to the backend console
  (`Logger.debug`) instead of sent, until an email module exists.
- Swagger/OpenAPI decorators — this file is the source of truth for now.
