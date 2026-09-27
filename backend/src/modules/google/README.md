# Google module

OAuth connect + live Search Console / Analytics reads for the Organic
tab. Spec: `docs/analysis/google.md`. One connection per client (refresh
token AES-256-GCM encrypted, scopes merged across grants); site/property
matching per project domain at fetch time; no metrics ever persisted.

## Public API

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/team/clients/:clientId/google/connect-url?provider=gsc\|ga` | `manage_client_settings` | consent URL (stateless signed state, 10 min) |
| GET | `/team/clients/:clientId/google/status` | `view_projects` | `{ gsc: { connected }, ga: { connected } }` |
| POST | `/team/clients/:clientId/google/disconnect` | `manage_client_settings` | revoke at Google (best-effort) + delete row |
| GET | `/team/clients/:clientId/projects/:projectId/google/search-console?days=28` | `view_projects` | totals + previous + top queries/pages + daily |
| GET | `/team/clients/:clientId/projects/:projectId/google/analytics?days=28` | `view_projects` | totals + previous + daily sessions/users/pageviews |
| GET | `/auth/google/callback?code&state` | public | exchanges, stores, 302s to `/client?google=connected` (or `?google=error`) |

Guards: unconfigured → 503 `google-unconfigured`; no connection/scope →
404 `google-not-connected`; no matching site/property → 404
`google-no-site` / `google-no-property` (linked, but nothing for this
domain); Google API errors → 503 `google-fetch-failed`.

## Env vars

| Var | Notes |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | web OAuth client; unset → honest 503 |
| `GOOGLE_REDIRECT_URI` | must also be registered in Google Console |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | 32 random bytes as hex; wrong shape → 503 |

## Dependencies

- Modules: none (leaf). npm: `googleapis` (official).
- Consumers: Organic frontend tab (via HTTP).

## Testing

- `google.service.spec.ts`: AES roundtrip + corrupt token, host/site
  matching, guards (unconfigured/missing scope), scope merging on
  re-grant, GA property match preference. Google HTTP is not mocked —
  fetch logic is verified live (see below).
- Live verification deferred: needs the redirect URI registered plus a
  real Google-grant click-through in the browser (operator step).
