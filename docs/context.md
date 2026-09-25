# Project context

Cailyx is a Rothenhall product, rebuilt from scratch (previous repo at
`../cailyx` had accumulated structural mistakes). Invite-only — no
self-signup. One shared login screen for everyone; role + per-client
feature flags determine what's visible.

## How this repo is being built

One module at a time, end-to-end (DB → backend → frontend) before the next
starts, per `AGENTS.md`. Each module gets a design doc in
`docs/analysis/<module>.md` before any code is written, and a README inside
its own `backend/src/modules/<module>/` folder once it's done.

## Where things live

- `docs/analysis/` — per-module design docs (DB schema rationale, decisions,
  open questions), written *before* building each module.
- `docs/Readme.md` — the REST API reference (all endpoints, request/response
  shapes). Kept manually in sync until Swagger is wired up.
- `docs/features.md` — living module-by-module status + PRD-alignment
  tracking.
- `docs/chagelog.md` — running changelog, newest first.
- `backend/src/modules/<name>/README.md` — per-module detail: architecture,
  dependencies, env vars, testing notes.

## Feature architecture: every feature is a plugin, with per-client config

Decided 2026-09-25, before building any real feature module. Product
features (content calendar, blog generation, email marketing, AEO audits,
Day-1 report, etc.) are **not just on/off switches per client** — different
clients pay for different subsets and configurations of the same feature.
Example: a content-calendar feature might have one client on blogs only,
another on blogs + email, each possibly with different settings within
that (posting frequency, channels, etc.).

**What this means for how features get built:**

- Each feature module owns its own configuration shape — don't assume a
  single boolean is ever enough. A feature's "is this on for this client"
  question and "how is it configured for this client" question are the
  same concern, not two separate ones.
- The `client_feature_flags` table from the login module (`clientId`,
  `featureKey`, `enabled`) was designed as a simple on/off placeholder
  *before* this principle was articulated. It's almost certainly not the
  final shape — expect it to evolve into something that can carry a
  per-client config payload (e.g. a JSON column) per feature, not just a
  boolean. Revisit its design when the first real feature module needs
  per-client configuration, rather than guessing the shape now.
- Don't build generic "feature flag management" UI/API ahead of an actual
  feature needing it (this is why we're not building it right now, even
  though the table already exists) — each feature module should bring its
  own configuration screen/endpoints when it's built, following this
  plugin-shaped pattern, rather than a separate central toggle-everything
  admin panel.

## Stack

- **Backend**: NestJS 12, Prisma 7 (`@prisma/adapter-pg`), Postgres via
  Supabase.
- **Frontend**: Next.js 16 (App Router, Turbopack), shadcn/ui (Base UI
  variant — note: composition uses a `render` prop, not Radix's `asChild`).
- Both are independent projects (no npm workspaces) — install/run each from
  its own directory.

## Current state (as of the login module)

See `docs/features.md` for the live status table. Short version: login,
invite/onboarding, and admin/team management are fully built and manually
verified end-to-end against the live Supabase DB. Email sending isn't wired
up yet (Plunk credentials exist but no verified sender is configured), so
invite/reset links are logged to the backend console for now.
