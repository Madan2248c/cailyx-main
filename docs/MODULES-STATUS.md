# Modules & Flow — living reference

Last updated: 2026-09-27. This is the map to build the frontend and the
email module against — every module below is backend-only today (except
`auth`/`projects`, which have a minimal frontend already). Nothing in
`web/`/`frontend/` exists yet for anything past Projects.

Each module has its own `docs/analysis/<module>.md` (the approved build
spec) and `backend/src/modules/<module>/README.md` (what actually shipped,
API surface, PRD alignment). This doc is the one-page overview connecting
them — read a module's own two docs for real detail.

## Build order so far

```
✅ auth            → login, RBAC, invite-by-admin, seat limits
✅ projects        → client → project(s), name+domain only
✅ discovery       → company context profile (13-stage pipeline)
✅ technical-audit → 8 site checks, composite score
✅ social-activity → Apify social-cadence audit
✅ query-set       → LLM-invented prompt buckets → prompts
✅ measurement     → runs query-set prompts across surfaces (Cloro)
✅ aeo-audit       → stance judging + verdict; owns the Competitor table
✅ gap-analysis    → consolidates findings into ranked recommendations
✅ competitors     → tech/SEO/reviews comparison vs each competitor
✅ reporting       → DAY1 + MONTHLY report generation, live-verified
✅ day1-pipeline   → auto-orchestrator (creation → 9 stages → DAY1 → ready email)
✅ email           → Plunk sender (leaf, no REST/DB), wired into auth invite/resend/reset; day1-pipeline's "report ready" step unblocked
```

## What each module actually does

**`auth`** — login, role-based access (`ADMIN` / `CLIENT_POC` /
`CLIENT_MEMBER`), invite-by-admin onboarding (magic-link tokens emailed
via Plunk, debug-logged only when email is unconfigured; POC invite
deferrable until the Day-1 report is ready), per-client seat
limits, JWT access + refresh-token rotation.

**`projects`** — a client can have multiple projects (multiple
domains/brands). Admin creates a project with `{ name, domain,
day1SpendConsent: true, day1SpendCeilingUsd? }` — creation starts the
Day-1 pipeline automatically. Everything else about it is inferred by
later pipeline modules, not this one. Everything downstream keys off a
project, not a client directly.

**`discovery`** — given a project's domain, crawls it and builds a
`CompanyContextProfile`: services, ICP, pains, outcomes, competitors,
verified social profile URLs. A 13-stage resumable pipeline (`DISCOVER →
INSPECT → SELECT → EXTRACT → RECONCILE → VALIDATE → SOCIAL_DISCOVERY →
EXTERNAL_ENRICH → CONSOLIDATE → GAP_RESEARCH → VERIFY → COMPILE`). This
profile is the grounding input almost every later module reads from.

**`technical-audit`** — 8 checks against the project's site: robots.txt,
CDN/bot-block, JS-render dependency, Core Web Vitals (PageSpeed Insights),
schema.org/JSON-LD, sitemap, AI-crawler agent-readiness, per-page SEO
inventory (the `seo-rubric.ts` scoring function, reused later by
`competitors`). Rolls into one 0–100 composite score + an LLM narrative.

**`social-activity`** — given Discovery's verified social profile URLs,
pulls each platform's last-30-days posts via Apify, buckets posting
cadence (`daily` / `every-2-3-days` / `weekly` / `sporadic` / `dormant`).
**Findings only, no recommendations, no score** — by design.
Spend-gated: requires `APIFY_API_KEY` + explicit `confirmSpend: true`.

**`query-set`** — generates a project's buyer-prompt set. Two-LLM-call
pipeline: (1) given the `CompanyContextProfile`, invent the bucket list
for **this specific business** (no fixed taxonomy — a niche business gets
buckets no other project has), each with a name/rationale/persona/funnel
stage/branding; (2) generate prompts within each bucket. Guardrails in
code: 4–14 buckets, 5–40 prompts/bucket, ≥70% unbranded, and a
rationale-grounding check (a bucket whose stated rationale doesn't match a
real context field is rejected). Versioned, immutable once activated.

**`measurement`** — runs an **active** query set's prompts against answer
engines via Cloro (multi-key fallback, concurrency-limited, async
submit→poll), n≥5 repeats, cost-capped. Records mention/citation/position
per observation. Deliberately has **no** share-of-voice/competitor
detection at this layer — that's AEO Audit's job.

**`aeo-audit`** — ties an active query set to its measurement runs,
**judges stance** per observation (a separate LLM call — "was the client
recommended, mentioned neutrally, or lost to a rival"), assembles a
verdict (headlines, rate slices — **no invented composite score**). Owns
the single `Competitor` table other modules read from (`CompetitorSource`:
`manual` / `stance_discovered` — auto-populated from co-mentioned rival
names in LLM answers — / `serp_discovered`, added by `competitors`).

**`gap-analysis`** — the **first and only place a recommendation gets
generated** in this pipeline. Reads the latest completed run from
`technical-audit`, `social-activity`, and `aeo-audit` (read-only, via
their own services), one LLM call consolidates + merges related findings
across sources into a ranked list of concrete next steps. Guardrails: every
recommendation must cite a real finding it's grounded on (rejected
otherwise), 3–15 items per run, no fabricated numbers. Recommendations
carry a staff-tracked `OPEN`/`DONE`/`DISMISSED` status.

**`competitors`** — reuses `aeo-audit`'s `Competitor` table (no second
list). Discovery is fully automatic: `aeo-audit`'s existing
`stance_discovered` co-mentions, plus new SERP queries via **DataForSEO**
(terms drawn from `CompanyContextProfile`, not hand-typed) — every
distinct ranking domain becomes `serp_discovered`. Per competitor (and the
project's own domain, for a fair baseline): tech-stack fingerprint
(ported, zero-cost signature table), schema/JSON-LD types, an SEO score
using `technical-audit`'s **actual** `seo-rubric.ts` (homepage only, not a
full audit), and a review rating **if the competitor's own homepage embeds
one** (no G2/Trustpilot auto-discovery yet). `/gap` is a deterministic
diff — no LLM judgment.

**`reporting`** — done, `d551a52`, live-verified against Fello (16/16
steps). One module, two `kind`s:
- `DAY1`: generated once, automatically, at the end of the Day-1 pipeline.
  **Bypasses the editorial review gate entirely** — goes straight to
  `RELEASED` (explicit trade-off: the very first thing a new client sees
  has had zero human review, in exchange for a fully automatic onboarding
  flow). No baseline to diff against; sections ordered worst-finding-first.
- `MONTHLY`: recurring, scheduled. Keeps the full editorial lifecycle
  (`DRAFT → IN_REVIEW → RELEASED`, staff must release it) and diffs every
  metric against the previous report — "if a number went down, it goes in
  the headline."
- Both share the same tables/render pipeline. Content pulled read-only
  from `technical-audit`, `social-activity`, `aeo-audit`, `competitors`,
  `gap-analysis` — a missing source is omitted, never fabricated.
- `visibility` (public/private) and `status` (editorial) are independent
  axes, never derived from each other — a revoked share link never
  un-releases a report; releasing never makes it public.
- Visual design: obsidian/linen/terracotta palette, Jost/Instrument
  Sans/Fraunces-italic type system, ported from
  `docs/day1-report-pdf-style-guide.md`'s component vocabulary (KPI
  tiles, meter bars, severity badges, quote blocks, callouts) — **not**
  that system's raw-HTML-per-report mechanism, which was a one-off
  hand-built exercise with zero reuse.
- **Deferred, not yet built**: PDF export, email delivery.
- **Known schema gap** (judgment call during build, not yet a real
  column): `approve({approved:false, changesRequested})` logs
  `changesRequested` but doesn't persist it.

## Repo-wide doc-maintenance notes (surfaced 2026-09-27, not this doc's job to fix)

- `docs/API.md` (referenced in `AGENTS.md`'s checklist) has never actually
  existed in this repo — every module has used its own README's "Public
  API" table instead. That's the real convention; treat `AGENTS.md`'s
  mention of a central `API.md` as aspirational, not current practice.
- `docs/features.md`'s per-module PRD-alignment tables stopped being kept
  up after `technical-audit` and were never restarted for anything after.
- **`competitors` is missing its `docs/chagelog.md` entry** — dropped in a
  commit-bundling mixup during that build. Not yet backfilled.

## The Day-1 pipeline orchestrator (shipped 2026-09-27)

`day1-pipeline` chains the modules automatically — spec
`docs/analysis/day1-pipeline.md`, one `Day1PipelineRun` row per project,
BullMQ queue, 9 stages run **sequentially** (parallel fan-out left out
deliberately):

```
1. Admin creates client + project
   — the project form carries the spend pre-authorization
     (`day1SpendConsent: true` + optional `day1SpendCeilingUsd`).
     The client form can defer the POC invite until the report is ready.

2. Orchestrator runs automatically:

   Discovery → Technical Audit → Social Activity
     → Query Set (generate → activate) → AEO Audit (ChatGPT-only, US)
       → Competitors → Gap Analysis → Reporting (DAY1, auto-RELEASED)
         → notify ("your Day-1 audit is ready" email)

   Only `reporting` is fatal — any other stage failure is recorded and
   the pipeline continues (Reporting tolerates missing sources).
   Retries resume past recorded stages. Ceiling enforced best-effort
   before the paid stages.

3. On Reporting RELEASED:
   → still-INVITED POC gets the deferred first invite with ready context;
     already-ACTIVE POC gets a login-link ready email.

4. Client clicks link → sets password → onboarding flow with
   PREFILLED details (from CompanyContextProfile — services, ICP, etc.),
   editable before confirming → lands in the app with the report open.
   Step 4's onboarding UI + the client report viewer do not exist yet —
   this is frontend work, same as everything else in this doc.
```

**What's still open or missing:**
- The onboarding UI (password setup + prefilled/editable details) and the
  client report viewer — entirely frontend, entirely unbuilt.
- Live end-to-end verification of a full pipeline run (scheduled as the
  full-repo E2E pass).

## Frontend status

`auth` (login/invite/reset), `projects` (create/list), spend pre-auth +
deferred-invite admin dialogs, and the client **onboarding wizard**
(`/onboarding`: 7 steps — welcome, basics, offerings, customers, presence
+ socials, competitors, review — prefilled from the latest project's
company-context/socials/competitors, editable by the POC via the client
correction endpoints, read-only for members) have UI in `frontend/`.

Nothing exists yet for: discovery progress, technical-audit results,
social-activity results, query-set builder/viewer, measurement runs,
aeo-audit verdict/narrative, gap-analysis recommendations list,
competitors comparison, or the report viewer (client-facing). The Organic
tab exists with connect-gated Search Console / Analytics dashboards
(`docs/analysis/google.md`); it shows connect cards until the client's
Google account is linked. Each module's own README documents its REST API surface — that's
the contract to build the frontend against.

## Reference docs, in build order

`docs/analysis/auth.md` · `docs/analysis/projects.md` ·
`docs/analysis/discovery.md` · `docs/analysis/technical-audit.md` ·
`docs/analysis/digital-presence-audit.md` (social-activity) ·
`docs/analysis/query-set.md` · `docs/analysis/gap-analysis.md` ·
`docs/analysis/competitors.md` · `docs/analysis/reporting.md`.
(`measurement` and `aeo-audit` were built directly per explicit operator
instruction, skipping the doc-first step every other module went
through — no `docs/analysis/` doc exists for either; their module READMEs
are the only spec of record.)
