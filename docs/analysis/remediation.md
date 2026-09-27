# Analysis — `remediation` module ("Fix Plan")

Status: **built (2026-09-28) — v1, staff-facing backend.** See
`backend/src/modules/remediation/README.md` for the as-built detail.

## Why this module exists

The audit modules say **what is wrong** (Technical Audit, Social Activity,
AEO Audit). Gap Analysis says **what matters most** — 3–15 ranked
recommendations in prose. Neither says, per problem, **exactly how to fix
it, and whether it is actually fixed**.

Remediation is that layer. It turns every finding into a **fix spec**: one
tracked record per problem × target (page or site) carrying the evidence,
a ready-to-use fix where one can be computed, numbered steps, and a
machine-checkable acceptance check — then proves the fix on the live site.

It is shaped from day one so the same records can later be consumed by a
code-fixing agent (Eos-style) or an MCP server: every fix spec is
structured JSON with a stable fingerprint, a `groupKey` for batching into
one PR, and an acceptance check an agent cannot fake.

Named `remediation` in code; shown to people as **"Fix Plan"**.

## What changed vs. the old codebase

The old `cailyx/backend/src/modules/remediation/` had the right core idea
(fix specs, handlers, verification) and is the reference for this design.
Kept: fingerprint dedup, one handler per problem family, "only the module
can mark verified". Changed:

- **String-typed status/class columns → Postgres enums.** The old
  `FixSpec.status`/`fixClass`/`method` were free strings.
- **History is a real append-only table** (`fix_spec_events`), not
  overwritten columns — every status change, decision and verification
  result is kept.
- **No LLM inside sync.** Sync is deterministic and cheap; the LLM runs
  only when an operator explicitly asks for a copy draft on one fix
  (`POST …/fixes/:id/draft`), under a per-project daily cap. A re-sync
  never overwrites a draft.
- **Verification reuses the audit's exported code** (`extractPageSignals`,
  `findPageIssues`, `parseRobotsTxt`/`selectGroup` + `RobotsService`'s
  matcher) rather than a second implementation that could disagree.

## Scope (v1)

In:
- Fix specs from **Technical Audit** (all 8 checks + per-page issues),
  **Social Activity** (dormant/infrequent platforms) and **AEO Audit**
  (losing prompts).
- Deterministic generated fixes: `robots.txt` (create / minimal-change
  unblock / declare sitemap), Organization JSON-LD from the confirmed
  company profile, canonical tag, `llms.txt`.
- Status flow + client decisions (recorded by staff on the client's behalf
  in v1), live verification, next-audit verification, regression.
- Optional LLM copy draft per fix (title/meta rewrites, AEO answer-page
  brief), grounded and number-checked.
- Link from each fix spec to the Gap Analysis recommendation that cites the
  same finding.
- Export: fix pack as Markdown or JSON.

Out (deliberately, v1):
- **No changes to other modules.** Not wired into the Day-1 pipeline, not
  auto-triggered on audit completion, no Report section yet. Each is a
  small follow-up on the owning module's side (see "Follow-ups").
- No client-facing endpoints (client decisions are recorded by an admin).
- No agent API keys / MCP server (v2 — the data shape is already ready).

## Pipeline

```
POST …/remediation/sync           (admin, synchronous, no LLM, no paid call)
 1. Collect     latest COMPLETE run of each source via its own exported
                service (TechnicalAuditService, SocialActivityService,
                AeoAuditService, DiscoveryService, GapAnalysisService)
                → one SourceSnapshot. Zero sources → 409.
 2. Detect      every handler reads the snapshot → FixSpecDraft[]
                (pure, deterministic, unit-tested)
 3. Guardrails  each draft must cite a finding present in the snapshot;
                generated artifacts must validate (robots.txt re-parsed and
                re-checked, JSON-LD must parse); failures are dropped + noted
 4. Merge       drafts with the same fingerprint merge their sources
 5. Upsert      by fingerprint = sha256(projectId | problemKey | target)
 6. Reconcile   specs whose problem is no longer reported by a newer run
                that actually looked → VERIFIED (next-audit)
                VERIFIED specs reported again by a newer run → REGRESSED
 7. Link        gapRecommendationId from the latest Gap Analysis run
 8. Record      RemediationRun COMPLETE with created/updated/verified/
                regressed counts
```

## Fix spec vocabulary

| Field | Values |
|---|---|
| `fixClass` | `CODE` · `CONFIG` · `CONTENT` · `OFF_SITE` · `INVESTIGATE` |
| `method` | `GENERATED` (code-built artifact) · `LLM_DRAFT` (words needed) · `INSTRUCTIONS` · `HUMAN` |
| `severity` / `effort` | `LOW` · `MEDIUM` · `HIGH` — ordinal labels, never a computed score |
| `status` | see below |

### Status flow

```
OPEN ─────────────► IN_PROGRESS ─► APPLIED ─(verify passes)─► VERIFIED
 ▲  AWAITING_DECISION ─approve─┘      │                          │
 │        └─decline─► DISMISSED       └─(verify fails)─► OPEN    │
 └──────────── REGRESSED ◄──(newer audit reports it again)───────┘
any (except VERIFIED) ─► DISMISSED (reason required) ─reopen─► OPEN
```

- `VERIFIED` is set **only** by a verifier (live check or a newer audit
  that no longer reports the problem) — never by a person or an agent.
- A person/agent saying "done" is `APPLIED`.

### Acceptance checks

| Kind | Verified by |
|---|---|
| `robots-exists` | live: `/robots.txt` returns 2xx |
| `robots-allows` | live: fresh robots.txt, every named bot allowed at `/` (RobotsService matcher) |
| `robots-declares-sitemap` | live: fresh robots.txt has a `Sitemap:` line |
| `json-ld-has` | live: homepage has an Organization-type JSON-LD block with the named fields non-empty |
| `page-issue-absent` | live: page re-fetched, `extractPageSignals` + `findPageIssues` no longer report the code |
| `finding-absent` | next audit only: a newer completed run of that module no longer reports it |

## Guardrails (enforced in code)

- **Grounding** — every draft cites ≥1 `(module, findingRef)` that exists in
  the collected snapshot; otherwise dropped.
- **Artifact validity** — generated robots.txt must re-parse and allow the
  bots it claims to unblock; JSON-LD must `JSON.parse`; an artifact that
  can't be built for lack of input records `artifactError`, never guesses.
- **Never unblock training crawlers silently** — blocked training bots are
  a `needsClientDecision` spec; the generated robots.txt only unblocks
  search/live-fetch agents.
- **LLM drafts** — no number may appear in a draft unless it appears in the
  grounding text; output length-checked against the SEO bands; per-project
  daily cap (`REMEDIATION_MAX_DRAFTS_PER_DAY`, default 20).
- **Page-level volume bound** — at most `MAX_PAGE_SPECS` (150) page-level
  specs per sync, worst pages first.

## Entities

- `remediation_runs` — one sync pass, append-only.
- `fix_specs` — the living record, upserted by fingerprint. The one table in
  this module that is edited after creation, because real fixes move
  through stages. Every change is also written to `fix_spec_events`.
- `fix_spec_sources` — grounding: which finding(s) produced a spec.
- `fix_spec_events` — append-only history (status changes, decisions,
  verification results, drafts).

Source-run ids and `gap_recommendation_id` are plain UUID columns without a
foreign key, so this module adds no relation fields to other modules'
models (only `Project` gains two back-relations).

## LLM use

| Task | Model |
|---|---|
| Sync, generated artifacts, verification | none |
| Copy drafts (on request) | the shared `LlmModule` (`AEO_LLM_MODEL` via OpenRouter, Anthropic fallback) |

A per-task model override (e.g. a stronger writing model for client-facing
copy) needs a small `LlmModule` change and is a follow-up, not done here.

## Follow-ups (each owned by another module, intentionally not done here)

1. Day-1 pipeline: add a `remediation` stage between `gap-analysis` and
   `reporting`.
2. Technical Audit / Social Activity / AEO Audit: enqueue a remediation sync
   on run completion (catches regressions automatically).
3. Reporting: a "Fix Plan" section read via `RemediationService.summary`.
4. Client portal endpoints for viewing the plan and deciding.
5. v2: scoped API keys → agent routes → MCP server.
6. `LlmModule`: per-call model override.
