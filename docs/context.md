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
