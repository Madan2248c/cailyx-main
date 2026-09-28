# Going to production

How the client portal and API run in production, what has to be set, and
the order to ship in.

## Shape

```
browser ──https──> frontend (Next.js)  ──server-side only──> backend (NestJS) ──> Postgres (Supabase)
                     /api/* proxy routes                        │  └──> Redis (BullMQ queues + fetch cache)
                                                                └── Chromium (Playwright) for rendered-page checks
```

- Browsers only ever talk to the frontend. The backend should **not** be
  publicly reachable except for `GET /auth/google/callback` (Google redirects
  the browser there). Put it on a private network, or allow only that path
  and `/health` publicly.
- The frontend is stateless. The backend runs the queue workers, so it needs
  Redis and must stay running (not a scale-to-zero function).

## Images

| Service | Build | Runs |
| --- | --- | --- |
| API | `docker build -t cailyx-api backend/` | `node dist/main` on `PORT` (3001), healthcheck built in |
| Migrations | same image | `npm run db:migrate` (`prisma migrate deploy`), then exits |
| Portal | `docker build -t cailyx-portal frontend/` | `node server.js` on 3000 |

**On Railway:** follow [`railway.md`](./railway.md). Each app ships a
`railway.json`; migrations run as the API's pre-deploy command.

The portal can also go on Vercel as-is (`output: "standalone"` is ignored
there). The API can't: it needs long-running workers, Redis and Chromium.

## Environment

### Portal

| Variable | Required | Notes |
| --- | --- | --- |
| `BACKEND_URL` | yes | API base URL, e.g. `http://cailyx-api:3001`. The app refuses to start requests without it in production. |

### API (see `backend/.env.example` for everything)

Required in production (the API won't boot without them):

| Variable | Notes |
| --- | --- |
| `NODE_ENV=production` | Turns on the strict checks below. |
| `DATABASE_URL` | Supabase Postgres. Use the pooler URL. |
| `JWT_ACCESS_SECRET` | 32+ random characters, unique to production. |
| `FRONTEND_URL` | The portal's public `https://` URL. Invite and reset emails link here. |
| `REDIS_URL` | Queues and cache. |
| `GOOGLE_REDIRECT_URI` | `https://<api host>/auth/google/callback`, required once `GOOGLE_CLIENT_ID` is set. Register the same URL in Google Cloud Console. |

Needed for the features to work (each fails closed, with a clear error, when unset):
`OPENROUTER_API_KEY`, `PSI_API_KEY`, `APIFY_API_KEY`, `CLORO_API_KEY`,
`PLUNK_SECRET_KEY` + `PLUNK_SENDER_EMAIL`, `GOOGLE_CLIENT_ID` +
`GOOGLE_CLIENT_SECRET` + `GOOGLE_TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`).

Must stay off in production (the API refuses to boot if either is `1`):
`DATAFORSEO_ALLOW_MOCK`, `MEASUREMENT_ALLOW_MOCK`. These produce made-up
data that clients would read as real.

Optional: `OBSERVE_APP_KEY` + `OBSERVE_APP_SECRET` for NestJS Observe
telemetry (off without both).

## Release order

1. Run the migrations against the production database (`npm run db:migrate`
   in the API image; automatic on Railway). It applies every pending
   migration in `backend/prisma/migrations`, in order, and is safe to re-run.
2. Deploy the API. Wait for `GET /health` to return `200` (`503` means the
   database is unreachable).
3. Deploy the portal.
4. Smoke test: sign in as a client, open the dashboard, the Fix Plan and one
   fix, download the fix pack, and sign in as an admin and open
   "Preview as client".

Roll back by redeploying the previous images. Migrations are additive; don't
roll the database back.

## What's already hardened

- Security headers on the portal (no framing, no sniffing, HSTS, no indexing,
  `no-store` on API responses) and on the API.
- Clients can only reach their own client's data (`ClientScopeGuard` on every
  `team/clients/:clientId` route).
- Refresh token in an `httpOnly`, `secure` (production), `SameSite=Lax` cookie;
  access token in memory only.
- Login lockout after repeated failures (`LOGIN_MAX_ATTEMPTS`,
  `LOGIN_LOCKOUT_MINUTES`).
- The proxy rejects route params that try to climb out of their path.
- Clean shutdown on `SIGTERM` (DB pool, Redis, workers).
- Branded 404 and error pages; errors show a reference id, never a stack.

## Known gaps before a wide launch

- **Keyword, backlink and search-overview data**: live DataForSEO isn't wired
  in this build, and the mock is (correctly) off in production. Those pages
  show their "on its way" state until the live adapter is built.
- **Rate limiting** is per-account lockout only. Add IP rate limiting at the
  load balancer or CDN for `/api/auth/*`.
- **Script CSP**: the CSP covers framing, base URI, objects and forms. A full
  `script-src` policy needs per-request nonces.
- **Error tracking**: set the Observe keys, or add another error tracker, so
  production errors are visible without reading logs.
- **Backups**: confirm Supabase point-in-time recovery is on for the
  production project.
