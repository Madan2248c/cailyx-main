# Gap Analysis module (SOP-5)

**The first and only place a recommendation gets generated in this
pipeline.** Reads the latest completed run from Technical Audit, Social
Activity, and AEO Audit (via their own exported services — no
cross-module DB reads), and consolidates every finding into one ranked
list of concrete next steps via a single LLM call. No new taxonomy, no
re-derived findings, no invented numbers — see
`docs/analysis/gap-analysis.md` for the design and why this departs from
the old repo's rules-engine classifier.

## Architecture

```
modules/gap-analysis/
  gap-analysis.module.ts          # wiring; exports GapAnalysisService only
  gap-analysis.constants.ts       # item-count bounds, per-source row caps
  gap-analysis.types.ts           # SourceFinding, RawRecommendation, etc.
  collectors/
    technical-audit.collector.ts  # latest COMPLETE run → citable findings
    social-activity.collector.ts  # latest COMPLETE run → citable findings
    aeo-audit.collector.ts        # latest completed audit → citable findings
  controllers/
    gap-analysis.controller.ts    # project-nested run/list, run-id-scoped read, recommendation-id-scoped status update
  dto/
    gap-analysis.dto.ts           # recommendation status body
  services/
    gap-analysis.service.ts       # orchestrator: collect, consolidate, guardrails, persist
    gap-analysis-generation.service.ts # the one LLM call
    gap-analysis.guardrails.ts    # pure, deterministic checks over the raw proposal
```

Reuses `LlmModule` (no new provider), and imports `TechnicalAuditModule`
/ `SocialActivityModule` / `AeoAuditModule` to reach their exported
services — never their Prisma models directly. No new auth
infrastructure; `view_projects` scopes reads, `ADMIN` gates writes.

## A note on the design doc's premise

The doc states none of the three source modules emit a "recommended
action" per finding. Checked while collecting: **Technical Audit's own
`AuditFinding.recommendedFix` is genuinely populated** by every check
(e.g. `sitemap.check.ts`'s exact fix text) — a real per-finding
suggestion, not a doc inaccuracy caught late. This doesn't change what
gets built: Gap Analysis's value is the cross-source **merge** into one
ranked list (a "shore up LinkedIn presence" item combining a Technical
Audit finding with a Social Activity dormant-platform finding is not
something either source could produce alone) and the single priority
order across everything — that holds regardless of whether one source's
raw findings already suggest something in isolation. `recommendedFix`
text is used as grounding material, same as every other finding.

## Collection: read-only, via each source's own service

Each collector calls `listRuns`/`list` on its source service, picks the
first with a **completed** status (`COMPLETE` for Technical Audit and
Social Activity, `completed` for AEO Audit — different casing, ported
as each module already defines it), and flattens the run into a flat
list of `SourceFinding { module, findingRef, summary }`:

- **Technical Audit**: one per `AuditFinding` (`findingRef` = check
  type), plus `composite-score` and `narrative` as two more citable rows.
- **Social Activity**: one per platform finding (`findingRef` =
  `platform:type`), plus one per run-over-run delta (`findingRef` =
  `delta:platform:metric`).
- **AEO Audit**: `getVerdict()` recomputed fresh (never the cached
  blob), then headlines (`headline:0`, `headline:1`, ...),
  `competitorStanding` rows (`competitor:name`), and `judged.losingPrompts`
  (`losing-prompt:observationId`) — capped at 10 rows each to keep the
  LLM prompt bounded.

A project missing a completed run from one or more sources is not an
error — the run proceeds on whatever's available. Zero sources with a
completed run is a 409: nothing to consolidate.

## Generation: one LLM call, then deterministic guardrails

`GapAnalysisGenerationService.consolidate()` is the only LLM call in this
module — given every collected finding, it proposes a ranked, merged
list. Everything after that is pure validation:

1. **Rationale-grounding**: every `(module, findingRef)` a recommendation
   cites must exist in the collected data — a recommendation citing
   nothing real is dropped, per-item (same pattern as Query Set's bucket
   check), not a whole-proposal rejection.
2. **No fabricated numbers**: every numeric/percentage token in a
   recommendation's title+description must already appear in the text of
   the specific findings *it cites* (not the whole pool) — a recommendation
   stating an invented number is dropped.
3. **Item-count bound**: 3–15 recommendations must survive the drops
   above, or the whole run is rejected (409, not auto-padded/trimmed) —
   retry, consolidation is non-deterministic.
4. **Ranking**: the LLM's own priority order becomes `priorityRank`
   (1 = most influential) — ordinal only, never a fabricated score.

## Persistence: one mutable field, by design

`GapAnalysisRun` is append-only (no `deleted_at`) like every other
pipeline module. `GapAnalysisRecommendation.status`
(`OPEN`/`DONE`/`DISMISSED`) is the deliberate exception — staff need to
track what's actually been done, and it's set via `PATCH`, never
regenerated by a later run.

## Public API

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/team/clients/:clientId/projects/:projectId/gap-analysis/runs` | ADMIN | consolidate the latest available source runs; 409 if none exist or the guardrail-passed count is out of range |
| GET | `/team/clients/:clientId/projects/:projectId/gap-analysis/runs` | `view_projects` | list, newest first |
| GET | `/team/clients/:clientId/gap-analysis/runs/:id` | `view_projects` | one run + ranked recommendations |
| PATCH | `/team/clients/:clientId/gap-analysis/recommendations/:id` | ADMIN | update `status` only |

## Env

None new — reuses `LlmModule`'s existing `OPENROUTER_API_KEY` /
`ANTHROPIC_API_KEY`.

## Testing

Guardrails are pure functions tested against synthetic recommendations
(grounding, per-citation number scoping, count bounds, rank contiguity —
no live LLM). The generation service is tested against a mocked
`LlmService` (malformed-entry dropping). Each collector is tested against
a mocked source service (completed-run selection, finding flattening).
The orchestrator is tested with every collaborator mocked: 409 on zero
sources, running on a single available source (a missing source is not
an error), 409 on an out-of-range guardrail-passed count (never
auto-fixed), ungrounded items dropped with contiguous re-ranking.
Controller pass-through covered.

**Live end-to-end run** against Fello — recorded in `docs/chagelog.md`:
COMPLETE, 3 grounded recommendations from the one available source
(AEO Audit — Social Activity's and Technical Audit's completed runs for
Fello had been cleaned up by their own earlier live tests, a real
exercise of the "missing source is not an error" path). Every citation
resolved to a real headline/competitor reference, no fabricated numbers,
contiguous ranks. One recommendation correctly merged all 8 co-mentioned
competitor names from `competitorStanding` into a single "build
comparison pages" action item — the cross-finding merge this module
exists to do.
