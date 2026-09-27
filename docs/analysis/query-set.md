# Analysis — `query-set` module (SOP-1)

Status: **approved (2026-09-27) — fully open-ended bucket invention.**
Nothing built yet.

## What changed vs. the old codebase

The old `cailyx/backend/src/modules/query-set/` was **manual-only**: a
CRUD service for versioned prompt sets, no generation at all — "seeded from
real sources where available in paid tiers, manual on free tier." Every
prompt was typed in by a human.

This rebuild adds **LLM-driven generation, organized into buckets that are
themselves decided per business** — not a fixed taxonomy. The old
codebase's `aeo-audit/aeo-matrix.generator.ts` had a fixed 10-dimension
taxonomy (`service-discovery`, `head-to-head`, `geo-vertical`, …) applied
identically to every client; the user explicitly rejected reusing that as a
fixed list. Two decisions, made together on 2026-09-27:

1. **Prompt generation moves from AEO Audit into `query-set`** (SOP-1
   layering fix — AEO Audit consumes an already-built query set, it doesn't
   generate its own).
2. **The bucket list is invented per project from its site context, not
   drawn from a shared enum.** A niche business gets buckets no other
   project has. Trade-off accepted knowingly: this breaks cross-project
   comparability for anything that slices by "dimension" (AEO Audit's
   future stance/verdict analysis, any benchmarking across clients) —
   each project's buckets are its own vocabulary. What's gained: buckets
   that actually reflect how *this* business's buyers ask questions,
   instead of forcing every client through the same 10 angles regardless
   of fit (e.g. `geo-vertical` is dead weight for a pure remote SaaS with
   no local intent at all).

## Scope

Build, version, and manage a project's prompt set in two LLM steps:
**(1) decide which prompt buckets this business needs**, grounded in its
site context, then **(2) generate prompts within each chosen bucket**.
Versioned, immutable once activated.

Explicitly out of scope for this pass: running the prompts against any
answer engine (`measurement`, SOP-2) and judging/scoring the resulting
answers (AEO Audit, which consumes an active query set + measurement's
results — and, per the layering fix above, no longer generates prompts
itself).

## Decisions carried over from the old design (kept)

- **Immutable once activated** — mutations only happen on `draft` sets;
  activating locks it. Changing a set means `fork()`-ing the next version.
  This is what makes "compare this month's citation rate to baseline"
  meaningful — the baseline can't have quietly changed underneath you.
- **Persona × funnel-stage taxonomy stays fixed**: `problem-aware /
  solution-aware / product-aware / most-aware`. This is *not* reopened by
  the bucket decision above — funnel stage is a buyer-journey concept
  independent of the business, unlike the topic/angle buckets, and
  `measurement`/reporting aggregate by it across projects. Every invented
  bucket must still be tagged with one of these four stages (see pipeline
  step 2).
- **Subject (project) owns the set, can export it** — `GET .../export`
  stays.
- **100–300 prompts** is the target range for a full set (PRD-carried
  number), smaller on constrained tiers.

## Buckets: invented per project, not a fixed enum

There is no `PromptDimension` union anymore. Instead, generation produces a
project-specific list of buckets, each with:

- `name` — short slug the LLM invents, grounded in the site context (e.g.
  `integration-partner-fit`, `pricing-tier-comparison`, `on-call-coverage`
  — whatever actually matches how this business's buyers search, not a
  name picked from a pre-set list)
- `rationale` — one sentence citing the specific site-context fact that
  justifies this bucket existing (a service, an ICP trait, a competitor, a
  named pain point). **Required, and checked**: a bucket whose rationale
  doesn't reference anything in the grounding context is rejected before
  generation spends budget on it (guards against invented buckets that
  aren't actually grounded in anything real).
- `persona` / `funnel_stage` — from the fixed four-value taxonomy above
- `branding` (`branded` / `unbranded`) — same rule as before: most buckets
  should be unbranded (the real visibility test); the LLM must justify any
  bucket it marks branded
- `target_count` — how many prompts this bucket gets, decided by the LLM
  as part of bucket proposal, bounded by the guardrails below

### Guardrails (non-negotiable, enforced in code, not left to the LLM)

Open-ended generation still needs bounds or a bad context (or a bad LLM
turn) produces an unusable set:

- **Bucket count**: 4–14 buckets per query set. Below 4, a set can't cover
  problem/solution/product/most-aware meaningfully; above 14, buckets get
  too thin to matter at 100–300 total prompts.
- **Per-bucket prompt count**: 5–40. A bucket under 5 doesn't justify
  existing as its own bucket vs. folding into another; the ceiling stops
  one bucket eating the whole budget.
- **Total set size**: still governed by `generation_tier` (e.g.
  `starter`/`full`), same as before — bucket `target_count`s must sum to
  within tier bounds; if the LLM's proposal overshoots, counts are scaled
  down proportionally, never dropped ad hoc.
- **Unbranded ratio floor**: at least 70% of total prompts must come from
  `unbranded` buckets — carries forward the old rule that unbranded
  visibility is the primary signal.
- **Rationale-grounding check**: as above — a bucket proposal whose
  rationale can't be matched against the actual `CompanyContextProfile`
  fields it claims to cite is dropped, not generated.

## Generation pipeline

```
1. Grounding    pull the project's latest CompanyContextProfile
                (Discovery module — already built, no new dependency)
                → services, ICP, pains, outcomes, competitors, geo/vertical
2. Propose      LLM call #1 (reuses LlmModule — no new provider/tool):
                given the site context, propose the bucket list — name,
                rationale, persona, funnel_stage, branding, target_count.
                Guardrails above applied to the raw proposal before
                anything is generated.
3. Generate     LLM call #2 per bucket (or batched): produce target_count
                prompts for that bucket, grounded in the same context.
                Each prompt inherits its bucket's persona/funnel_stage/
                branding.
4. Persist      query_set_buckets rows + query_set_items rows, each item
                linked to its bucket.
```

This is not seeded/deterministic the way the old fixed-taxonomy allocator
was — bucket *invention* is inherently non-deterministic across contexts.
What stays deterministic: the guardrail checks (bucket count, per-bucket
count, unbranded ratio, rationale-grounding) run in code on the LLM's
output, so a proposal that violates them is corrected or rejected the same
way every time, even though the creative content varies.

**No new external tool or API to approve.** Generation reuses the existing
`LlmModule` (OpenRouter default / Anthropic fallback) exactly as Discovery,
Technical Audit, and Social Activity already do.

## Entities

### `query_sets`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| project_id | uuid fk → projects.id | |
| version | int | starts at 1, `fork()` increments |
| label | text, nullable | |
| status | enum `QuerySetStatus` (`draft`, `active`, `archived`) | |
| source | enum `QuerySetSource` — **extended**: adds `llm-generated` alongside `manual`, `sales-questions`, `support-tickets` | |
| generation_context_id | uuid fk → company_context_profiles.id, nullable | which Discovery profile this set was grounded on, for traceability |
| generation_tier | text, nullable | the target-size tier used for bucket sizing (e.g. `starter` / `full`), null for manual sets |
| activated_at | timestamptz, nullable | |
| created_at / updated_at | timestamptz | |

Note: `persona` is dropped from this table — the old design had one
persona per whole query set, but buckets now each carry their own persona,
so a single generated set naturally spans all four.

### `query_set_buckets` (new)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| query_set_id | uuid fk → query_sets.id | |
| name | text | LLM-invented slug, unique within the set |
| rationale | text | one sentence, must cite a specific context field (checked, see guardrails) |
| persona | enum `PromptPersona` | |
| funnel_stage | enum `FunnelStage` | |
| branding | enum `PromptBranding` (`branded`, `unbranded`) | |
| target_count | int | post-guardrail, scaled count actually used |
| created_at | timestamptz | |

### `query_set_items`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| query_set_id | uuid fk → query_sets.id | |
| bucket_id | uuid fk → query_set_buckets.id, nullable | null for manually-added items |
| prompt | text | |
| funnel_stage | enum `FunnelStage` | copied from bucket at generation time (denormalized so a manual item can still be tagged without a bucket) |
| branding | enum `PromptBranding`, nullable | copied from bucket; null for manual items unless tagged |
| generation_method | enum (`llm-generated`, `manual`) | audit trail |
| created_at | timestamptz | |

All three tables soft-delete-free (append-only), consistent with
Discovery's "never edited in place, a new version supersedes" pattern.

## API

| Method | Path | Notes |
|---|---|---|
| `POST` | `/team/clients/:clientId/projects/:projectId/query-sets` | manual create (v1, draft) |
| `POST` | `/team/clients/:clientId/projects/:projectId/query-sets/generate` | **new** — two-step LLM generation; body `{ tier }`; requires a `CompanyContextProfile` to exist (409 without one); response includes the proposed bucket list for visibility |
| `POST` | `/team/clients/:clientId/query-sets/:id/prompts` | add prompt to a draft (manual) |
| `DELETE` | `/team/clients/:clientId/query-sets/:id/prompts/:itemId` | remove prompt from a draft |
| `POST` | `/team/clients/:clientId/query-sets/:id/activate` | lock the set |
| `POST` | `/team/clients/:clientId/query-sets/:id/fork` | new draft version |
| `GET` | `/team/clients/:clientId/projects/:projectId/query-sets` | list, `?status=` filter |
| `GET` | `/team/clients/:clientId/query-sets/:id` | one set + buckets + items |
| `GET` | `/team/clients/:clientId/projects/:projectId/query-sets/export` | full export, client-owned artifact |

## Env vars

None new — generation reuses `LlmModule`'s existing `OPENROUTER_API_KEY` /
`ANTHROPIC_API_KEY` config, already in `.env.example`.

## Dependencies

- **Modules**: `PrismaModule` (global), `LlmModule`, Discovery (reads
  `CompanyContextProfile`, read-only — no write coupling).
- **Consumers**: `measurement` (SOP-2) runs prompts from an **active**
  query set; AEO Audit consumes an active query set + measurement results
  and does **not** generate its own prompts (closes the layering gap this
  doc opened with).

## Testing notes for the build

Because bucket invention is non-deterministic, unit tests target the parts
that must stay deterministic regardless of LLM output: guardrail
enforcement (bucket-count clamping, per-bucket count clamping, unbranded
floor, rationale-grounding rejection) against synthetic bucket proposals,
not live LLM calls. A mocked LLM adapter (same pattern as Social Activity's
Apify test doubles) covers the two-call pipeline shape. One live end-to-end
run against a real project is still required before this is marked
verified, same bar as Technical Audit and Social Activity.
