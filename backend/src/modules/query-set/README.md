# Query Set module (SOP-1)

A project's versioned prompt set, built in two LLM steps: propose per-
project buckets grounded in Discovery's `CompanyContextProfile`, then
generate prompts per bucket. Buckets are **not** a fixed taxonomy — invented
per project, bounded by deterministic guardrails enforced in code. See
`docs/analysis/query-set.md` for the full design.

## Architecture

```
modules/query-set/
  query-set.module.ts             # wiring; exports QuerySetService only
  query-set.constants.ts          # guardrail bounds + tier target sizes
  query-set.types.ts              # bucket proposals, guardrail notes
  controllers/
    query-set.controller.ts       # project-nested + set-id-scoped routes
  dto/
    query-set.dto.ts              # create / generate / add-prompt bodies
  services/
    query-set.service.ts          # orchestrator: manual CRUD, generate, activate/fork, export
    query-set-generation.service.ts # two LLM calls via the shared LlmModule
    query-set.guardrails.ts       # pure, deterministic bound-checks over the raw proposal
    query-set.grounding.ts        # flattens CompanyContextProfileJson into searchable terms
```

Reuses `LlmModule` (the one constrained-JSON client — no new provider, no
new env vars) and the existing `JwtAuthGuard` / `RolesGuard` /
`PermissionsGuard` from `common/`. No new permission: `view_projects`
scopes reads, `ADMIN` gates writes. Reads Discovery's
`CompanyContextProfile` read-only — no write coupling.

## Buckets: invented per project, not a fixed enum

Generation produces a project-specific bucket list — `name` (LLM-invented
slug), `rationale` (must cite something real from the site context),
`persona` / `funnel_stage` (fixed four-value taxonomies), `branding`, and
`target_count`. There is no `PromptDimension` union: a niche business gets
buckets no other project has.

## Guardrails (deterministic, code-enforced)

Applied in this order over the raw LLM proposal — see
`query-set.guardrails.ts`:

1. **Rationale-grounding rejection** — a bucket whose rationale doesn't
   contain a real term from the flattened `CompanyContextProfile` is
   dropped before anything downstream counts or sizes it.
2. **Bucket-count check** — 4–14 buckets must survive grounding, or the
   whole proposal is rejected (409) rather than padded/trimmed.
3. **Per-bucket clamp** — each `target_count` clamped into [5, 40].
4. **Tier scaling** — if the clamped total exceeds the tier's budget
   (`starter: 60`, `full: 200` — **not pinned in the analysis doc, this
   build's own default, flag to the coordinator if wrong**), every
   bucket's count scales down proportionally, never dropped ad hoc.
5. **Unbranded-floor check** — at least 70% of the (post-scaling) total
   must come from unbranded buckets, or the proposal is rejected (409).

Steps 2 and 5 **reject**, they don't silently correct — a proposal that
fails either comes back as a 409 telling the caller to retry generation
(bucket invention is non-deterministic, so a retry can produce a valid
proposal from the same context).

## Immutability

Mutations (`addPrompt`, `removePrompt`, generation's own writes) only ever
touch a `draft` set — enforced by `assertDraft` before any write.
`activate()` locks it (`status: active`, `activatedAt` set). Changing an
active set means `fork()`, which copies every bucket and item into a new
draft version (`version: latest + 1`) — the original set is never edited.

## Public API

See `docs/Readme.md` for full request/response shapes. Summary:

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/team/clients/:clientId/projects/:projectId/query-sets` | ADMIN | manual create (v1, draft) |
| POST | `/team/clients/:clientId/projects/:projectId/query-sets/generate` | ADMIN | two-step LLM generation; body `{ tier? }`; 409 without a `CompanyContextProfile` or a failed guardrail |
| GET | `/team/clients/:clientId/projects/:projectId/query-sets` | `view_projects` | list, `?status=` filter |
| GET | `/team/clients/:clientId/projects/:projectId/query-sets/export` | `view_projects` | the active set, full export |
| GET | `/team/clients/:clientId/query-sets/:id` | `view_projects` | one set + buckets + items |
| POST | `/team/clients/:clientId/query-sets/:id/prompts` | ADMIN | add manual prompt; 400 if not draft |
| DELETE | `/team/clients/:clientId/query-sets/:id/prompts/:itemId` | ADMIN | remove prompt; 400 if not draft |
| POST | `/team/clients/:clientId/query-sets/:id/activate` | ADMIN | lock the set; 400 if not draft |
| POST | `/team/clients/:clientId/query-sets/:id/fork` | ADMIN | new draft version, copies buckets + items |

## Dependencies

- **Modules**: `PrismaModule` (global), `LlmModule`, Discovery (reads
  `CompanyContextProfile`, read-only — no write coupling).
- **Consumers**: `measurement` (SOP-2, not yet built) will run prompts from
  an **active** query set; AEO Audit consumes an active set + measurement
  results and does not generate its own prompts (the layering fix this
  module exists to close).
- **Env**: none new — generation reuses `LlmModule`'s existing
  `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY`.

## Testing

Guardrails are pure functions tested against synthetic bucket proposals
(no live LLM) — every bound, clamp, and rejection path covered
deterministically. The two-call generation service is tested with a
mocked `LlmService` (malformed-entry dropping, empty-prompt filtering).
The orchestrator is tested with a mocked generation service and Prisma
mock (draft-only mutation, 409 without a profile, 409 on guardrail
rejection without auto-fixing, per-bucket generation failure never
aborting the whole set, fork copying). Controller scope pass-through
covered. One live end-to-end run against a real project (with a real
Discovery `CompanyContextProfile`) is required before this is marked
verified.
