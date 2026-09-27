# Analysis — `google` module (Search Console + Analytics)

Status: **approved pattern — operator created the OAuth client (project
`cailyx`, web type) 2026-09-28.** Client id/secret + redirect URI live in
`backend/.env` (`GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`); the downloaded
`client_secret_*.json` is gitignored, never committed.

## What this unlocks

The Organic tab's dashboard: GSC connection alone unlocks it (clicks,
impressions, CTR, position, top queries/pages); GA adds sessions/users
cards when connected. Nothing auto-runs — data is fetched live per page
view, no pipeline stage, no stored metrics.

## Operator actions required (Google Cloud Console, before live use)

1. Add `http://localhost:3001/auth/google/callback` (and later the prod
   URL) to the OAuth client's **authorized redirect URIs** — none are
   registered yet, and the flow 400s without it.
2. Enable APIs on project `cailyx`: **Search Console API**, **Google
   Analytics Data API**, **Google Analytics Admin API**.

## Scope

- OAuth 2.0 authorization-code flow, `googleapis` npm package (official).
- Scopes: `webmasters.readonly` (GSC), `analytics.readonly` (GA4).
  Requested incrementally: the GSC connect asks only its scope, GA only
  its own — each grant is independent.
- Connections are per **client** (one Google account per client, shared
  across their projects); site/property matching is per project domain at
  fetch time, so nothing property-specific goes stale in storage.

## Entities

`GoogleConnection`: `clientId` unique, `scopes[]` (granted so far),
`refreshTokenEncrypted` (AES-256-GCM, `GOOGLE_TOKEN_ENCRYPTION_KEY`),
`createdAt/updatedAt`. No access tokens stored (short-lived, fetched per
request from the refresh token). No metrics stored — every read is live.

## Flow

- `GET /team/clients/:id/google/connect-url?provider=gsc|ga`
  (`manage_client_settings`, POC-only) → `{ url }`. `state` is a
  short-lived JWT (signed with `JWT_ACCESS_SECRET`, 10 min) carrying
  `{clientId, provider, nonce}` — stateless CSRF protection, no storage.
- `GET /auth/google/callback?code&state` (public) — verifies state,
  exchanges the code, upserts the connection (merging scopes), then 302s
  to `${FRONTEND_URL}/client?google=connected`.
- `GET /team/clients/:id/google/status` (`view_projects`) →
  `{ gsc: { connected }, ga: { connected } }`. The matched site/property is
  reported by the overview endpoints below (matching is per project).
- `POST /team/clients/:id/google/disconnect`
  (`manage_client_settings`) — revokes at Google, deletes the row.
- `GET …/projects/:pid/google/search-console?days=28`
  (`view_projects`) → `{ totals, previousTotals, byQuery[10], byPage[10],
  byDate[] }` via `searchanalytics.query` (two ranges for deltas).
- `GET …/projects/:pid/google/analytics?days=28` (`view_projects`) →
  `{ totals, previousTotals, byDate[] }` (sessions, activeUsers,
  screenPageViews) via the GA4 Data API; 404 `ga-not-connected` when the
  GA scope is missing (the UI keeps its connect card).

## Matching

- GSC: `sites.list` → first `siteUrl` containing the normalized domain
  (`sc-domain:` or URL form). No match → null site.
- GA4: `accountSummaries.list` → property whose display name contains
  the domain stem, else the first property, else null. (GA4 properties
  expose no website URL in this API version, so the name is the only
  matchable signal — the UI shows which property was picked.)

## Failure posture (same honest guards as every integration)

- Unconfigured (`GOOGLE_CLIENT_ID/SECRET` unset) → 503
  `google-unconfigured`, nothing attempted.
- No connection / missing scope → 404 `google-not-connected`.
- No matching site/property → 200 with null + the UI explains.
- Google API error / expired grant → 503 `google-fetch-failed` (revoked
  grants surface here; the UI offers reconnect).

## Out of scope

Scheduled pulls, stored metrics/trends, multi-account, write scopes,
per-project connections, BigQuery export.
