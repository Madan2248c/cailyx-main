# Deploying on Railway

Railway project **lively-gratitude** (production environment) runs three
resources, all defined in [`.railway/railway.ts`](../../.railway/railway.ts):

| Service | What | Public URL |
| --- | --- | --- |
| `frontend` | Next.js client portal, built from `frontend/Dockerfile` | https://frontend-production-1f7f.up.railway.app |
| `backend` | NestJS API, built from `backend/Dockerfile` | https://backend-production-9558a.up.railway.app (for `/health` and the Google sign-in callback) |
| `redis` | Queues and fetch cache | private only |

Postgres is Supabase, outside Railway. The portal calls the API over
Railway's private network (`BACKEND_URL`); the API reaches Redis privately.

## How it deploys

Every push to `main` rebuilds only the app whose folder changed (watch paths
`/backend/**`, `/frontend/**`). An API release:

1. builds `backend/Dockerfile` (Node + Chromium for page rendering and the
   Fix Plan PDF),
2. runs `npm run db:migrate` (`prisma migrate deploy`) as the pre-deploy
   command; if it fails the release stops and the old version keeps serving,
3. starts the API and switches traffic once `GET /health` returns 200.

## Changing the infrastructure

Edit `.railway/railway.ts`, then from the repo root:

```bash
npm install            # once: the Railway SDK the file imports
railway config plan    # preview, changes nothing
railway config apply   # apply after reviewing the plan
```

Railway's per-service `railway.json` ("Config as Code") is deprecated and
stops being read on 2026-12-01; this repo doesn't use it.

**Windows + Volta:** `railway config` fails ("requires Railway CLI 5.42.1 or
newer", or "node returned non-JSON output") because Volta's `node` and
`railway` shims mangle the CLI's calls. Point both at the real binaries:

```bash
RW="$LOCALAPPDATA/Volta/tools/image/packages/@railway/cli/node_modules/@railway/cli/bin/railway.exe"
PATH="$LOCALAPPDATA/Volta/tools/image/node/22.22.2:$PATH" _="$RW" "$RW" config plan
```

## Secrets

Secrets are never in git. The file marks them `preserve()`; set or rotate
them with the value on stdin so it isn't echoed or saved in shell history:

```bash
printf '%s' "$VALUE" | railway variable set KEY --stdin --service backend
```

Set on `backend`: `JWT_ACCESS_SECRET` (production-only, random),
`GOOGLE_TOKEN_ENCRYPTION_KEY` (must stay the key that encrypted the stored
Google tokens), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`OPENROUTER_API_KEY`, `PSI_API_KEY`, `APIFY_API_KEY`, `CLORO_API_KEY`,
`PLUNK_SECRET_KEY`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, and
`DATABASE_URL` (Supabase pooler string).

Never set `DATAFORSEO_ALLOW_MOCK` or `MEASUREMENT_ALLOW_MOCK` to `1`: the API
refuses to start in production with made-up data on.

## Google sign-in

Register this redirect URI on the OAuth client in Google Cloud Console:

```
https://backend-production-9558a.up.railway.app/auth/google/callback
```

`GOOGLE_REDIRECT_URI` and `FRONTEND_URL` reference the services' public
domains, so they follow a custom domain automatically.

## Custom domain

`railway domain portal.rothenhall.com --service frontend --port 3000`, then
add the DNS record Railway prints. Nothing else changes.

## Checks after a deploy

- `https://backend-production-9558a.up.railway.app/health` →
  `{"status":"ok","database":"up",…}`
- Sign in on the portal as a client: dashboard, Fix Plan, one fix, both
  downloads (fix list and PDF overview).
- Sign in as an admin: **Preview as client** on one project.
