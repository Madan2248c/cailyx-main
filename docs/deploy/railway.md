# Deploying on Railway

Three services in one Railway project: **backend** (NestJS API), **frontend**
(Next.js portal) and **Redis**. Postgres stays on Supabase.

Each app carries its own config as code (`backend/railway.json`,
`frontend/railway.json`): Dockerfile build, watch paths, healthcheck, restart
policy, and for the API a pre-deploy step that runs database migrations.

> Railway only auto-creates one service per package for JavaScript
> **workspace** monorepos. This repo is two independent apps, each with its
> own lockfile, so each service is pointed at its folder once (step 2). After
> that, every push to `main` deploys on its own.

## 1. Create the project

1. Railway dashboard → **New Project** → **Deploy from GitHub repo** →
   `Rothenhall/cailyx-main`. Railway creates one service; this becomes
   **backend**.
2. **+ Create** → **GitHub Repo** → the same repo again. This becomes
   **frontend**.
3. **+ Create** → **Database** → **Redis**.

## 2. Point each service at its folder (one time)

In each service → **Settings**:

| Setting | backend | frontend |
| --- | --- | --- |
| Service name | `backend` | `frontend` |
| Source → Root Directory | `/backend` | `/frontend` |
| Config-as-code → Railway Config File | `/backend/railway.json` | `/frontend/railway.json` |

The config file path has to be absolute: Railway doesn't look for it inside
the root directory. Once it's set, the build, healthcheck, watch paths and
pre-deploy migration come from the file.

## 3. Variables

In each service → **Variables** → **Raw Editor**, paste and fill in. Values in
`${{ }}` are Railway reference variables and resolve by themselves; the
service names must match step 2.

### backend

```env
NODE_ENV=production
PORT=3001
DATABASE_URL=<Supabase pooler connection string>
JWT_ACCESS_SECRET=<32+ random characters, unique to production>
FRONTEND_URL=https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}
REDIS_URL=${{Redis.REDIS_URL}}

# Needed for the features to work (each fails closed with a clear error when unset)
OPENROUTER_API_KEY=
PSI_API_KEY=
APIFY_API_KEY=
CLORO_API_KEY=
PLUNK_SECRET_KEY=
PLUNK_SENDER_EMAIL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_TOKEN_ENCRYPTION_KEY=<openssl rand -hex 32>
GOOGLE_REDIRECT_URI=https://${{RAILWAY_PUBLIC_DOMAIN}}/auth/google/callback

# Optional telemetry (off unless both are set)
OBSERVE_APP_KEY=
OBSERVE_APP_SECRET=
```

Leave `DATAFORSEO_ALLOW_MOCK` and `MEASUREMENT_ALLOW_MOCK` unset: the API
refuses to start in production if either is `1`.

### frontend

```env
BACKEND_URL=http://${{backend.RAILWAY_PRIVATE_DOMAIN}}:${{backend.PORT}}
```

The portal reaches the API over Railway's private network, so the API needs
no public traffic except the Google sign-in callback.

## 4. Domains

- **frontend** → Settings → Networking → **Generate Domain** (or add your
  own, e.g. `portal.rothenhall.com`). This is the address clients use.
- **backend** → **Generate Domain** too, only because Google redirects the
  browser to `/auth/google/callback`. Register
  `https://<backend domain>/auth/google/callback` in Google Cloud Console.
  Skip this if Google isn't configured.

If you switch to custom domains later, `FRONTEND_URL` and
`GOOGLE_REDIRECT_URI` follow automatically (they reference the public
domain).

## 5. Deploy

Deploy **backend** first. Each release:

1. builds `backend/Dockerfile` (Node + Chromium for page rendering and the
   Fix Plan PDF),
2. runs `npm run db:migrate` (`prisma migrate deploy`) as the pre-deploy
   command. If a migration fails, the release stops and the old version keeps
   serving,
3. starts the API and waits for `GET /health` to return 200 (API and
   database both up) before switching traffic.

Then deploy **frontend**; it's live once `/robots.txt` answers.

## Check it

- `https://<backend domain>/health` returns `{"status":"ok","database":"up",…}`.
- Sign in on the frontend domain as a client: dashboard, Fix Plan, one fix,
  and both downloads (the Markdown list and the PDF overview).
- Sign in as an admin: **Preview as client** on one project.

## What's already handled in code

- Redis connections use dual-stack DNS (`family: 0`), so BullMQ and the fetch
  cache reach `redis.railway.internal` on IPv6-only networks.
- Both apps listen on IPv4 and IPv6 and on Railway's `PORT`.
- Watch paths (`/backend/**`, `/frontend/**`): a change to one app doesn't
  redeploy the other.
- Clean shutdown on redeploy; the API drains its database pool and queue
  workers.

See `production.md` for the full list of settings and known gaps.
