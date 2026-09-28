# Remediation module ("Fix Plan")

Turns audit findings into tracked **fix specs**. Each spec holds the evidence,
a ready-made fix where one can be computed, numbered steps, and a
machine-checkable acceptance check. The module then **proves** fixes on the
live site. Design: `docs/analysis/remediation.md`.

- Audits say *what is wrong*. Gap Analysis says *what matters most*.
  Remediation says *exactly how to fix each thing, and whether it is fixed*.
- Only a verifier can mark a fix `VERIFIED`: a live re-check, or a newer
  audit that looked and no longer reports the problem. A person or agent
  saying "done" is `APPLIED`.
- Sync uses no LLM and makes no paid call. The LLM runs only on an explicit
  per-fix "draft copy" request, under a per-project daily cap.

## Architecture

```
remediation/
  remediation.module.ts          wiring; exports RemediationService + RemediationSyncService
  remediation.types.ts           SourceSnapshot, FixSpecDraft, Artifact, AcceptanceCheck, handler contract
  remediation.constants.ts       every tuned bound
  collectors/
    source-snapshot.collector.ts reads the latest run of each source via its own exported service
  handlers/                      one pure `detect(snapshot) → drafts` per problem family
    handler.registry.ts          the list; adding a problem family = adding one handler here
    technical.handlers.ts        robots, cdn, sitemap, schema, js-render, cwv, agent-readiness
    page.handlers.ts             per-page issues (title/meta/h1/canonical) + grouped template issues
    presence.handlers.ts         dormant social platforms, losing AEO prompts
    common.ts                    snapshot readers, severity mapping
  generators/                    pure, no I/O, no LLM
    robots-txt.generator.ts      new file / minimal-change unblock / sitemap line
    robots-verdict.ts            "allowed at /?" via the real RobotsService matcher
    markup.generator.ts          Organization JSON-LD, canonical tag, llms.txt
  guardrails/
    remediation.guardrails.ts    grounding, artifact self-checks, reconcile coverage
  verifiers/
    live.verifier.ts             fresh fetch + the technical audit's own exported checks
  services/
    remediation-sync.service.ts  collect → detect → guardrails → merge → upsert → reconcile
    remediation.service.ts       reads, status moves, decisions, verify, summary, export
    remediation-draft.service.ts on-demand LLM copy drafts (title, meta, answer-page brief)
    fix-status.ts                the status machine (pure)
    fix-pack.ts                  export as JSON (agents) or Markdown (people)
  controllers/remediation.controller.ts
  dto/remediation.dto.ts
  testing/                       fixtures shared by the specs (not specs themselves)
```

## Dependencies

Imports `TechnicalAuditModule`, `SocialActivityModule`, `AeoAuditModule`,
`DiscoveryModule`, `GapAnalysisModule` (read-only, via each one's exported
service), `FetcherModule` (live verification) and `LlmModule` (drafts only).
**It changes no other module.** Outside this folder it only adds two
back-relations on `Project` in `schema.prisma` and one line in
`app.module.ts`.

Reused as-is from other modules, so verification means exactly "the audit
would no longer report this":
- `extractPageSignals` + `findPageIssues` (technical-audit)
- `parseRobotsTxt`, `selectGroup`, `RobotsService.isAllowed` (fetcher)
- `SEO_BANDS` (technical-audit constants)

## Tables

| Table | Notes |
|---|---|
| `remediation_runs` | One sync pass, append-only: sources read, created/updated/verified/regressed counts, guardrail drops. |
| `fix_specs` | The living record, unique on `fingerprint = sha256(projectId\|problemKey\|target)`. |
| `fix_spec_sources` | Which `(module, runId, findingRef)` produced the spec. Same ref format Gap Analysis cites. |
| `fix_spec_events` | Append-only history: every status change, decision, verification and draft. |

## What each source produces

| Source | Problem keys | Fix |
|---|---|---|
| robots | `robots.missing`, `robots.unblock-ai-crawlers`, `robots.training-crawlers-blocked` (client decision) | Generated robots.txt (self-checked with the real matcher) |
| sitemap | `sitemap.missing`, `sitemap.stale`, `sitemap.not-declared-in-robots` | Steps; generated `Sitemap:` line |
| schema | `schema.organization-missing`, `schema.organization-incomplete` | Generated Organization JSON-LD from confirmed facts only |
| cdn-inferred | `cdn.bot-blocked` | Vendor-specific steps |
| js-render | `render.js-dependent` | Developer steps (SSR/SSG) |
| cwv | `performance.core-web-vitals` | Failed Lighthouse audits as steps |
| agent-readiness | `agent.<issue-id>` | Generated `llms.txt` for the llms.txt issue; the tool's recommendation otherwise |
| page-inventory | `page.<issue>` per page for title/meta/h1/canonical (max 150); one grouped spec per other issue code | Generated canonical tag; LLM draft for title/meta |
| social-activity | `social.dormant-platform`, `social.infrequent-platform` | Off-site steps |
| aeo-audit | `aeo.losing-prompt` (keyed by prompt text) | LLM answer-page brief on request |

Decision-gated (`AWAITING_DECISION` until the client decides): blocked
training crawlers, cross-domain canonicals, `noindex`, duplicate content,
URL changes.

## API

All under `Authorization: Bearer`. Reads need `view_projects`; every write
is ADMIN only. See `docs/Readme.md` for request/response shapes.

| Method | Path | Does |
|---|---|---|
| POST | `/team/clients/:clientId/projects/:projectId/remediation/sync` | Sync from the latest audits (409 when none completed) |
| GET | `…/remediation/runs` | Sync history |
| GET | `…/remediation/fixes?status=&fixClass=&groupKey=&severity=` | Fix list, most severe first |
| GET | `…/remediation/summary` | Counts by status/class, open high-severity |
| GET | `…/remediation/export?format=md\|json` | Fix pack (Markdown for developers, JSON for agents) |
| GET | `…/remediation/export?format=pdf\|html` | One-page overview sent with the pack (`services/fix-brief.ts`; the PDF is printed by the fetcher's Chromium) |
| GET | `/team/clients/:clientId/remediation/runs/:id` | One run |
| GET | `/team/clients/:clientId/remediation/fixes/:id` | One fix with sources and history |
| PATCH | `…/fixes/:id/status` | `{status, reason?, prUrl?, note?}`. VERIFIED is refused. |
| POST | `…/fixes/:id/decision` | `{decision: APPROVED\|DECLINED, note?}` |
| POST | `…/fixes/:id/verify` | Live re-check. 409 for `finding-absent` fixes. |
| POST | `…/fixes/:id/draft` | LLM copy draft. 400 not draftable, 429 over cap, 503 no provider, 422 guardrail rejection. |

## Env vars

| Var | Default | Purpose |
|---|---|---|
| `REMEDIATION_MAX_DRAFTS_PER_DAY` | `20` | Per-project cap on LLM drafts in a rolling 24h window |

LLM provider/model come from `LlmModule` (`OPENROUTER_API_KEY` /
`AEO_LLM_MODEL`, Anthropic fallback).

## Testing

`npx vitest run src/modules/remediation`: 93 tests across generators,
handlers, guardrails, status machine, sync, service, drafts, live verifier
and fix pack. Also checked on 2026-09-28, outside the unit tests:
- The robots.txt generator on the real robots.txt files of nytimes.com,
  theguardian.com and reuters.com. It unblocked every targeted bot (9, 6
  and 10), changed no other bot's access, and kept the original file
  verbatim.
- `findOrganization` and the page rubric on the real stripe.com and
  resend.com homepages.
- Nest DI resolves every provider and controller of this module in a full
  `AppModule` preview boot.

**Not yet done:** a live end-to-end sync against a real database. This
build had no `DATABASE_URL`/Redis. Run it the way other modules recorded
theirs, then add the result here.

## Not built (see the design doc's follow-ups)

Day-1 pipeline stage; auto-sync when an audit finishes; a "Fix Plan"
section in Reporting; client-facing endpoints; agent API keys and an MCP
server; per-task LLM model override. Each needs a small change in the
owning module and was deliberately left out, to keep this change isolated.
