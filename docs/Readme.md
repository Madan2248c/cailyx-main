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
Creates a client and invites its POC — unless `deferInvite` holds the
invite for the Day-1 pipeline (which sends the first invite with "your
audit is ready" context when the report releases).
Request: `{ "name": string, "pocEmail": string, "seatLimit"?: number, "deferInvite"?: boolean }` — `seatLimit` defaults to `1` if omitted (min `1`; counts the POC as a seat).
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
Creates a project under a client — and starts its Day-1 pipeline
automatically (see `docs/analysis/day1-pipeline.md`).
Request: `{ "name": string, "domain": string, "day1SpendConsent": true, "day1SpendCeilingUsd"?: number }` — consent is mandatory (creating a
project authorizes the automatic Day-1 spend); the ceiling is optional
(omitted = uncapped at this layer, per-module caps still apply).
Response `201`: `{ id, clientId, name, domain: "<normalized>", createdAt }`
Domain is normalized before storage/lookup: lowercase, strip `http(s)://`
and `www.`, keep only the hostname, drop a trailing `.`/`/`.
Errors: `404` client not found; `400` domain already active for this client
(one client can't have two active projects on the same normalized domain),
or consent missing/false.

### `GET /team/clients/:clientId/projects` — ADMIN, or requires `view_projects` permission scoped to own client
Lists the client's non-deleted projects, newest first.
Response `200`: `[{ id, clientId, name, domain, createdAt }]`
Errors: `404` client not found; `403` caller's `clientId` doesn't match (non-admin only).

### `PATCH /team/clients/:clientId/projects/:id/archive` — **ADMIN only**
Soft-deletes a project. No body. Response `200`: `{ "success": true }`.
Its domain becomes reusable for a new project under the same client.
Errors: `404` project not found (wrong client, already archived, or doesn't exist).

### `GET /team/clients/:clientId/projects/:id/day1` — **ADMIN only**
Day-1 pipeline status for a project (recovery ops). Response `200`: the
`day1_pipeline_runs` row (`status`, `currentStage`, per-stage `stages`).
Errors: `404` project not found.

### `POST /team/clients/:clientId/projects/:id/day1/retry` — **ADMIN only**
Re-enqueues a stalled (`QUEUED`) or failed Day-1 pipeline. Rejects
`COMPLETE`/`RUNNING` rows (`409` — retrying those would double-spend);
creates the row for legacy projects without one. No body.
Response `200`: the pipeline row.
Errors: `404` project not found; `409` already completed/running.

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

### `PATCH /team/clients/:clientId/projects/:projectId/company-context` — requires `manage_client_settings`
Client corrections to profile fields (onboarding). POC-only: this rewrites
pipeline output.
Request: `{ "fields": { "identity.business_name": string|null, "customers.industries": string[], … } }`
— `section.field` paths (everything except the evidence/meta sections);
scalars take a string (empty clears) or null, arrays take string[].
Unknown paths and kind mismatches are `400`.
Response `200`: the updated profile (same shape as the GET above).
Errors: `404` project not found, or no profile exists yet.

### `PATCH /team/clients/:clientId/projects/:projectId/social-profiles/:id` — requires `manage_client_settings`
Corrects a profile URL (onboarding). POC-only. Verification resets to
`POSSIBLE` with no score — the old verification no longer applies to a new URL.
Request: `{ "url": string }`
Response `200`: the updated row.
Errors: `404` project/profile not found; `400` garbage URL.

---

## Technical Audit — requires `Authorization` header

See `docs/analysis/technical-audit.md` for the design and
`backend/src/modules/technical-audit/README.md` for operational notes. Given
a project, this module crawls its site and runs eight technical/SEO checks
(robots.txt, CDN/bot-block probing, JS-render dependency, Core Web Vitals
via PSI, schema.org, sitemap, agent-readiness, per-page inventory), rolls
them into one 0-100 composite, diffs against the previous audit, and writes
an LLM narrative. It is **stage 2 of the Day-1 pipeline**. Runs execute on
the background `technical-audit` queue (concurrency 1), never inside the
HTTP call.

### `POST /team/clients/:clientId/projects/:projectId/technical-audit-runs` — **ADMIN only**
Queues an audit for the project. No body — the target URL comes from the
project's own domain. Returns the active run instead of starting a second
one when a run is already `QUEUED`/`RUNNING` for the project (a concurrent
run would corrupt the previous-run diff chain).
Response `202`: the run row (`{ id, projectId, status, triggeredBy,
previousAuditId, score, … }`). If the job queue is unreachable the row is
left `FAILED` with the reason.
Errors: `404` project not found (wrong client, archived, or doesn't exist).

### `GET /team/clients/:clientId/projects/:projectId/technical-audit-runs` — requires `view_projects`
This project's run history, newest first (max 20).
Response `200`: `[{ id, projectId, status, triggeredBy, previousAuditId,
score, findingSummary: [{ type, status, severity }], findings, deltas,
narrative, narrativeModel, startedAt, completedAt, createdAt }]`
`status` is one of `QUEUED`, `RUNNING`, `COMPLETE`, `FAILED`.
Errors: `404` project not found.

### `GET /team/clients/:clientId/projects/:projectId/technical-audit-trend` — requires `view_projects`
Score history, oldest first (max 200, default 30).
Response `200`: `[{ auditId, at, score, triggeredBy, failures }]`
Errors: `404` project not found.

### `GET /team/clients/:clientId/technical-audit-runs/:runId` — requires `view_projects`
One run, plus its worst 100 pages by score.
Response `200`: the run row above, plus `pages: [{ id, url, statusCode,
score, issues, signals, createdAt }]`.
Errors: `404` run not found, or it belongs to another client's project.

### `GET /team/clients/:clientId/technical-audit-runs/:runId/comparison` — requires `view_projects`
Previous-vs-current comparison for one run.
Response `200`: `{ currentAuditId, previousAuditId, currentAt, previousAt,
deltas: [{ metric, label, previous, current, change, direction,
higherIsBetter }], pageChanges: { added, removed, improved: [{ url, from,
to }], regressed } }`
Errors: `404` run not found, or it belongs to another client's project.

### `PUT /team/clients/:clientId/projects/:projectId/technical-audit-schedule` — **ADMIN only**
Sets the recurring cadence. `MANUAL_ONLY` removes the recurrence.
Request: `{ "cadence": "WEEKLY"|"MONTHLY"|"MANUAL_ONLY" }`
Response `200`: `{ id, projectId, cadence, active, createdAt, updatedAt }`
Errors: `404` project not found; `400` invalid cadence.

### `GET /team/clients/:clientId/projects/:projectId/technical-audit-schedule` — requires `view_projects`
Current schedule, or `null` when none was ever set.
Errors: `404` project not found.

---

## Social Activity — requires `Authorization` header

See `docs/analysis/digital-presence-audit.md` for the design and
`backend/src/modules/social-activity/README.md` for operational notes. Given
a project, this module pulls recent posts for its verified company social
profiles via Apify actors (dual spend gates — key + explicit opt-in),
aggregates per-platform cadence over a 30-day window (pattern buckets
daily → dormant), and stores dormant/infrequent findings. It is **stage 3
of the Day-1 pipeline**. Runs execute on the background `social-activity`
queue (concurrency 1), never inside the HTTP call.

### `POST /team/clients/:clientId/projects/:projectId/social-activity-runs` — **ADMIN only**
Queues a pull for the project. Body requires explicit spend approval:
`{ "confirmSpend": true, "platforms"?: ["linkedin", …], "postsPerPlatform"?: 20, "windowDays"?: 30, "includeProbable"?: false }`.
Without `confirmSpend: true` the trigger 400s and nothing is spent. Returns
the active run instead of starting a second one when a run is already
`QUEUED`/`RUNNING` for the project.
Response `202`: the run row. If the queue is unreachable the row is left
`FAILED` with the reason; if `APIFY_API_KEY` is unset at execution the run
fails closed.
Errors: `404` project not found; `400` missing opt-in or unknown platform.

### `GET /team/clients/:clientId/projects/:projectId/social-activity-runs` — requires `view_projects`
This project's run history, newest first (max 20).
Response `200`: `[{ id, projectId, status, triggeredBy, previousRunId,
platforms, postsPerPlatform, windowDays, includeProbable, totalCostUsd,
result, findings, deltas, narrative, narrativeModel, startedAt, completedAt,
createdAt }]`
`status` is one of `QUEUED`, `RUNNING`, `COMPLETE`, `FAILED`.
Errors: `404` project not found.

### `GET /team/clients/:clientId/social-activity-runs/:runId` — requires `view_projects`
One run, plus its per-platform aggregates.
Errors: `404` run not found, or it belongs to another client's project.

### `GET /team/clients/:clientId/social-activity-runs/:runId/comparison` — requires `view_projects`
Previous-vs-current comparison for one run.
Response `200`: `{ currentRunId, previousRunId, currentAt, previousAt,
deltas: [{ platform, metric, previous, current }] }`
Errors: `404` run not found, or it belongs to another client's project.

### `PUT /team/clients/:clientId/projects/:projectId/social-activity-schedule` — **ADMIN only**
Sets the recurring cadence + module config. `MANUAL_ONLY` removes the
recurrence. The scheduler fires nothing unless `spendOptIn` is true.
Request: `{ "cadence": "WEEKLY"|"MONTHLY"|"MANUAL_ONLY", "spendOptIn"?: boolean, "platforms"?: [...], "windowDays"?: number, "postsPerPlatform"?: number }`
Response `200`: the schedule row with its config payload.
Errors: `404` project not found; `400` invalid cadence.

### `GET /team/clients/:clientId/projects/:projectId/social-activity-schedule` — requires `view_projects`
Current schedule + config, or `null` when none was ever set.
Errors: `404` project not found.

---

## Query Set (SOP-1) — requires `Authorization` header

See `docs/analysis/query-set.md` for the design and
`backend/src/modules/query-set/README.md` for operational notes. A
project's versioned prompt set: manual CRUD on `draft` sets, or two-step
LLM generation grounded in Discovery's `CompanyContextProfile` (propose
per-project buckets → generate prompts per bucket, both bounded by
deterministic guardrails). Immutable once `active` — `fork()` for the next
editable version.

### `POST /team/clients/:clientId/projects/:projectId/query-sets` — **ADMIN only**
Manual create. No body required beyond an optional label.
Request: `{ "label"?: string }`
Response `201`: the new draft (v1) row.
Errors: `404` project not found.

### `POST /team/clients/:clientId/projects/:projectId/query-sets/generate` — **ADMIN only**
Two-step LLM generation: propose buckets grounded in the project's latest
`CompanyContextProfile`, apply guardrails, generate prompts per surviving
bucket.
Request: `{ "tier"?: "starter" | "full" }` (default `full`)
Response `201`: the new draft row plus `proposedBuckets` (the final,
guardrail-passed bucket list) and `guardrailNotes` (every clamp/scale
applied, for visibility).
Errors: `404` project not found; `409` no `CompanyContextProfile` exists
yet, or the proposal failed a rejecting guardrail (bucket count outside
4–14, or unbranded ratio below 70%) — retry, bucket invention is
non-deterministic.

### `GET /team/clients/:clientId/projects/:projectId/query-sets` — requires `view_projects`
This project's query sets, newest version first. `?status=draft|active|archived` filters.
Errors: `404` project not found.

### `GET /team/clients/:clientId/projects/:projectId/query-sets/export` — requires `view_projects`
The project's active set, full export (buckets + items).
Errors: `404` project not found, or no active set exists.

### `GET /team/clients/:clientId/query-sets/:id` — requires `view_projects`
One set + its buckets + items.
Errors: `404` set not found, or it belongs to another client's project.

### `POST /team/clients/:clientId/query-sets/:id/prompts` — **ADMIN only**
Adds one manually-typed prompt to a draft set.
Request: `{ "prompt": string, "funnelStage"?: string, "branding"?: "branded"|"unbranded" }`
Errors: `404` set not found; `400` set is not a draft.

### `DELETE /team/clients/:clientId/query-sets/:id/prompts/:itemId` — **ADMIN only**
Removes one prompt from a draft set.
Errors: `404` set or prompt not found; `400` set is not a draft.

### `POST /team/clients/:clientId/query-sets/:id/activate` — **ADMIN only**
Locks the set (`status: active`). Only a `draft` can be activated.
Errors: `404` set not found; `400` set is not a draft.

### `POST /team/clients/:clientId/query-sets/:id/fork` — **ADMIN only**
Creates a new draft version, copying every bucket and item from the
source set. The source set is never modified.
Response `201`: the new draft row.
Errors: `404` set not found.

---

## Remediation ("Fix Plan") — requires `Authorization` header

Turns audit findings into fix specs and verifies them. Reads need
`view_projects`; every write is **ADMIN only**. Full design:
`docs/analysis/remediation.md`.

A fix spec (as returned by every fix endpoint):
```json
{
  "id": "uuid", "projectId": "uuid", "fingerprint": "sha256",
  "problemKey": "robots.unblock-ai-crawlers", "target": "https://acme.com",
  "fixClass": "CODE|CONFIG|CONTENT|OFF_SITE|INVESTIGATE",
  "method": "GENERATED|LLM_DRAFT|INSTRUCTIONS|HUMAN",
  "groupKey": "robots", "severity": "LOW|MEDIUM|HIGH", "effort": "LOW|MEDIUM|HIGH",
  "title": "string", "evidence": {},
  "artifact": { "kind": "file|html-snippet|json-ld|copy", "path": "/robots.txt", "language": "text", "placement": "string?", "content": "string" },
  "artifactError": "string|null", "steps": ["string"],
  "acceptance": { "kind": "robots-exists|robots-allows|robots-declares-sitemap|json-ld-has|page-issue-absent|finding-absent" },
  "llmDraft": null, "needsClientDecision": false, "decision": "APPROVED|DECLINED|null",
  "status": "OPEN|AWAITING_DECISION|IN_PROGRESS|APPLIED|VERIFIED|REGRESSED|DISMISSED",
  "gapRecommendationId": "uuid|null", "prUrl": "string|null",
  "lastReportedAt": "iso", "lastVerifiedAt": "iso|null", "lastVerifyResult": {},
  "sources": [{ "module": "technical-audit", "runId": "uuid", "findingRef": "robots" }]
}
```

### `POST /team/clients/:clientId/projects/:projectId/remediation/sync` — **ADMIN only**
Builds/updates fix specs from the latest completed Technical Audit, Social
Activity and AEO Audit runs. No LLM, no paid call. Response `201`:
`{ runId, created, updated, verified, regressed, dropped }`. Errors: `404`
project; `409` no completed source run.

### `GET /team/clients/:clientId/projects/:projectId/remediation/runs` — requires `view_projects`
### `GET /team/clients/:clientId/remediation/runs/:id` — requires `view_projects`

### `GET /team/clients/:clientId/projects/:projectId/remediation/fixes` — requires `view_projects`
Query (all optional): `status` (comma-separated), `fixClass`, `groupKey`,
`severity`. Most severe first. `400` on an unknown value.

### `GET /team/clients/:clientId/projects/:projectId/remediation/summary` — requires `view_projects`
`{ total, byStatus: {OPEN: n, …}, byClass: {CODE: n, …}, openHigh }`

### `GET /team/clients/:clientId/projects/:projectId/remediation/export?format=md|json` — requires `view_projects`
Fix pack of every non-dismissed fix. `md` (default) is a Markdown download;
`json` is `{ project, generatedAt, fixes: [...] }`.

### `GET /team/clients/:clientId/remediation/fixes/:id` — requires `view_projects`
One fix with `sources` and `events` (full history).

### `PATCH /team/clients/:clientId/remediation/fixes/:id/status` — **ADMIN only**
Request: `{ "status": "OPEN|IN_PROGRESS|APPLIED|DISMISSED", "reason"?: string (required for DISMISSED), "prUrl"?: url, "note"?: string }`.
Errors: `400` VERIFIED requested (only `/verify` sets it) or missing
dismissal reason; `409` transition not allowed.

### `POST /team/clients/:clientId/remediation/fixes/:id/decision` — **ADMIN only**
Request: `{ "decision": "APPROVED|DECLINED", "note"?: string }`. APPROVED →
`OPEN`, DECLINED → `DISMISSED`. Errors: `400` fix needs no decision; `409`
not `AWAITING_DECISION`.

### `POST /team/clients/:clientId/remediation/fixes/:id/verify` — **ADMIN only**
Fresh live re-check of the acceptance check. Pass → `VERIFIED`; fail on an
`APPLIED` fix → `OPEN`. Result stored in `lastVerifyResult`. Errors: `409`
for `finding-absent` fixes (settled by the next audit + sync) or a status
that can't be verified.

### `POST /team/clients/:clientId/remediation/fixes/:id/draft` — **ADMIN only**
One LLM copy draft, stored on `llmDraft` (`kind: title|meta|answer-page`).
Errors: `400` fix has no copy to draft; `422` draft failed guardrails
(length band / invented numbers); `429` per-project daily cap
(`REMEDIATION_MAX_DRAFTS_PER_DAY`, default 20); `503` no LLM provider.

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
