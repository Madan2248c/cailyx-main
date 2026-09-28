# Analysis: connecting Remediation ("Fix Plan") to the client portal

Status: **proposed (2026-09-28).** Nothing in this doc is built yet.
Depends on: `docs/analysis/remediation.md` (the backend module, built) and the
client portal redesign (Graphite theme + Animate UI layer, built).

## 1. Why

The remediation module turns every audit finding into a tracked fix: evidence,
a ready-made fix where one can be computed, numbered steps, and a check that
proves it worked. Today none of that reaches the client. The portal shows
**what is wrong** (Technical, AI visibility, Social) and a short ranked list of
priorities (Gap Analysis), but never **exactly what to do, who is doing it, what
needs the client's say, and what has been proven fixed.**

That last part is the retention story: "9 of 14 fixes verified since your
baseline" is evidence of progress the client can see, instead of a promise.

It also completes two screens the product design plan (`design_plan.md` §4)
already specifies but nobody has built:

| Design plan screen | Route | What the Fix Plan supplies |
|---|---|---|
| **CP06 Plan & progress** | `/client/projects/:projectId/plan` | The plan itself: open work, blockers, client actions, verified progress |
| **CP16 Work handoff** | `/client/projects/:projectId/plan/:fixId` (design plan says `/work/:workId`) | Implementation guidance, the ready-made fix, live evidence, "mark ready for verification" |
| CP09 Approvals (partial) | surfaced inside CP06 | Fixes waiting on the client's decision (noindex, training crawlers, redirects) |

## 2. What exists today

### Backend (built, `backend/src/modules/remediation`)

| Method | Route | Guard today | Client use |
|---|---|---|---|
| POST | `/team/clients/:clientId/projects/:projectId/remediation/sync` | ADMIN | No (staff / automatic) |
| GET | `…/remediation/runs` | `view_projects` | No |
| GET | `…/remediation/fixes?status&fixClass&groupKey&severity` | `view_projects` | **Yes** |
| GET | `…/remediation/summary` | `view_projects` | **Yes** (badge, dashboard tile) |
| GET | `…/remediation/export?format=md\|json` | `view_projects` | **Yes** (hand to their developer) |
| GET | `/team/clients/:clientId/remediation/fixes/:id` | `view_projects` | **Yes**, but needs a client-safe view (§4.4) |
| PATCH | `…/fixes/:id/status` | ADMIN | Partly (client may mark "applied", §4.3) |
| POST | `…/fixes/:id/decision` | ADMIN | **Yes**, it is the client's decision (§4.3) |
| POST | `…/fixes/:id/verify` | ADMIN | Yes, rate-limited (§4.3) |
| POST | `…/fixes/:id/draft` | ADMIN | No (LLM spend; drafts are unreviewed proposals) |

Both client roles already hold `view_projects` (`prisma/seed.ts`), so the read
endpoints work for client users **today**, if the frontend calls them.

### Frontend

- No types, API client, route handlers or screens for remediation.
- The portal calls the backend through Next route handlers under
  `app/api/team/clients/[id]/…`, which forward the bearer token
  (`lib/backend-client.ts`). Remediation needs the same handlers.
- Reusable building blocks exist: `components/portal/*` (Tile, PageHeader,
  StatusChip, DeltaChip, ScoreRing, Meter, StackedBar, Hint, CountUp, Reveal)
  and Animate UI (Tabs, Tooltip, Highlight, Sliding Number, Button, Shine).

### Database

**The remediation migration is not applied** to the shared database
(`prisma migrate status` → `20260928120000_add_remediation_module` pending).
Nothing below works until it is.

## 3. Blocker found while planning: client scoping (fix first)

`PermissionsGuard` checks that the caller *has* a permission, but nothing checks
that the `:clientId` in the URL **is the caller's own client**. Only
`ProjectsService.listProjects` compares `caller.clientId !== clientId`. Every
module endpoint (technical audit, AEO, social, reports, competitors, and the
remediation routes above) trusts the URL. A signed-in client who learned another
client's `clientId` and `projectId` could read that client's data.

The IDs are random UUIDs, which lowers the risk, but this module adds **write**
actions for clients (decisions, "mark applied"), so the gap must be closed
before Phase 2, and it protects every existing module at the same time.

**Fix:** one `ClientScopeGuard` in `backend/src/common/guards/`:

```ts
// Non-admins may only act on their own client. Runs after JwtAuthGuard.
if (user.role !== Role.ADMIN) {
  const clientId = request.params.clientId;
  if (clientId && clientId !== user.clientId) throw new NotFoundException();
}
```

Added to the guard list of every controller mounted under
`team/clients/:clientId/…` (about 20 controllers:
`@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, ClientScopeGuard)`).
It returns 404, not 403, so it doesn't confirm that another client exists. Tests:
one guard spec, plus one e2e per module family that a CLIENT_MEMBER of client A
gets 404 on client B.

## 4. Backend changes

### 4.1 Apply the migration
`npx prisma migrate deploy` against the shared DB (whoever owns migrations).
Additive only: 4 new tables, 6 enums, no changes to existing tables.

### 4.2 Make sure a plan exists without staff action
Deferred in the remediation module on purpose; needed now:

1. **Day-1 pipeline stage** `remediation` between `gap-analysis` and
   `reporting` (`day1-pipeline.types.ts` `DAY1_STAGES`). Sync is deterministic
   and free, so it needs no spend pre-authorisation.
2. **Auto-sync after each audit completes** (Technical Audit, Social Activity,
   AEO Audit): call `RemediationSyncService.sync(clientId, projectId, null)` at
   the end of each module's `executeRun`, wrapped so a sync failure never fails
   the audit. This is what flips fixes to VERIFIED (or REGRESSED) on schedule.
3. **Staff "Sync fix plan" button** on the admin client-detail page, next to
   the schedules Madan added (`app/admin/clients/[id]`).

### 4.3 Client actions
New permissions (seed + migration, same pattern as `view_projects`):

| Permission | CLIENT_POC | CLIENT_MEMBER | Allows |
|---|---|---|---|
| `view_projects` (existing) | ✅ | ✅ | Read the plan, a fix, the summary, export |
| `decide_fixes` (new) | ✅ | ❌ | Approve or decline a fix that needs the client's say |
| `update_fixes` (new) | ✅ | ✅ | Mark a fix "applied" (their developer did it), with an optional note or PR link; request a re-check |

Route changes in `remediation.controller.ts`:
- `POST …/fixes/:id/decision`: `@Roles(ADMIN)` → `@RequirePermission('decide_fixes')`
  (admins still pass). Record the actor as the client user.
- New `POST …/fixes/:id/client-applied` with `update_fixes`: only
  OPEN/IN_PROGRESS/REGRESSED → APPLIED, optional `{ note, prUrl }`. Then it runs
  the live verifier immediately when the acceptance check is live-checkable,
  so the client sees "Verified" or "Not yet" within seconds. Clients never get
  the general status endpoint (no DISMISSED, no reopening).
- `POST …/fixes/:id/verify`: allow `update_fixes`, rate-limited to one live
  check per fix per 60 s (the verifier fetches the client's own site, so it's
  cheap, but not a loop).
- `draft` and `sync` stay ADMIN.

### 4.4 Client-safe projection
Add `RemediationService.getFixForClient` / `listFixesForClient`, used when
`user.role !== ADMIN`:
- **Hide `llmDraft`** unless staff have shared it (new boolean `draftShared`,
  set by staff). LLM drafts are unreviewed proposals (remediation design rule).
- **Events:** replace user ids with "You" (same client), "Rothenhall"
  (admin) or "Automatic check" (`system`).
- **Dismissed fixes:** return them with their reason, so the client sees
  "declined by you" or "not needed" instead of fixes silently vanishing.
- Everything else (evidence, steps, artifact, acceptance, status) is safe and
  is exactly what their developer needs.

### 4.5 Summary for badges
Extend `summary` with `awaitingDecision`, `verifiedSinceBaseline` (VERIFIED
with `lastVerifiedAt` after the project's first technical audit) and
`regressed`. It drives the sidebar badge and the dashboard tile.

## 5. Frontend plan

### 5.1 Plumbing
| File | Purpose |
|---|---|
| `types/remediation.ts` | `FixSpec`, `FixStatus`, `FixClass`, `AcceptanceCheck`, `Artifact`, `FixEvent`, `FixSummary` (mirror backend shapes) |
| `lib/remediation-api.ts` | `listFixes`, `getFix`, `getFixSummary`, `decideFix`, `markFixApplied`, `verifyFix`, `exportFixPack` |
| `app/api/team/clients/[id]/projects/[projectId]/remediation/{fixes,summary,export}/route.ts` | Proxies, same pattern as `technical-audit-runs/route.ts` |
| `app/api/team/clients/[id]/remediation/fixes/[fixId]/{route,decision,client-applied,verify}.ts` | Fix-scoped proxies |

### 5.2 Screens

**CP06 Fix Plan** `/client/projects/[id]/plan` (new sidebar item under
Workspace, with a count badge when decisions are waiting)

```
Fix Plan                                   [Download for your developer]
acme.com · 14 fixes · last checked 2 days ago
"9 of 14 fixes are verified. 2 need your decision."          ← marker on 9 of 14

┌ Progress (ink hero) ──────────┐ ┌ Needs your decision ───────────────┐
│ ring 9/14 verified            │ │ ApprovalCard: Let AI training bots │
│ stacked bar by status         │ │ read your site?  [Approve][Decline]│
│ ▲ 3 verified this month       │ │ ApprovalCard: noindex on /pricing  │
└───────────────────────────────┘ └────────────────────────────────────┘
[ All | To do | In progress | Verified ]   ← Animate UI Tabs, counts
┌ Robots.txt ──────────────── HIGH · 2 fixes ┐   ← grouped by groupKey
│ ● Unblock AI search crawlers   Ready file  │   → row links to detail
│ ● Declare sitemap in robots    Ready file  │
└────────────────────────────────────────────┘
┌ Pages ─────────────────────── 23 fixes ────┐  (collapsed after 5, "show all")
```

- Sections in order: **needs your decision** → **to do** → **in progress** →
  **verified** (wins last, but counted in the hero), grouped by `groupKey`.
- Each row: title, target (page path or "whole site"), severity chip, "ready-made
  fix" badge when `artifact` exists, who's on it (you / Rothenhall).
- Empty state: "No fixes yet. Your plan appears after your first audit."

**CP16 Fix detail** `/client/projects/[id]/plan/[fixId]`

```
← Fix Plan
Unblock AI search crawlers in robots.txt          [status chip]
acme.com · Robots.txt · high impact · low effort

┌ Why this matters ─────────┐ ┌ Done when ──────────────────────────┐
│ evidence in plain words   │ │ robots.txt allows OAI-SearchBot,    │
│ "PerplexityBot blocked…"  │ │ PerplexityBot at "/"                │
└───────────────────────────┘ │ Last check: ✗ still blocked (2h ago)│
┌ Ready-made fix ─────────────│ [Check now]                         │
│ /robots.txt   [Copy] [Download] └─────────────────────────────────┘
│ <pre> generated file </pre>
└──────────────────────────────
┌ Steps ─────────┐  ┌ History ───────────────────────────────┐
│ 1. … 2. …      │  │ Found by audit · 20 Sep                │
└────────────────┘  │ You marked applied · PR #42 · 26 Sep   │
                    │ Automatic check: verified ✓ · 26 Sep   │
[We've applied this]└────────────────────────────────────────┘
```

- "We've applied this" (POC and member): optional note or PR link → calls
  `client-applied` → shows the verifier result inline.
- Decision fixes show an **Approval card** (design plan §3.3: exact change,
  consequence, approve / decline with note) instead of the applied button.

### 5.3 Wiring into existing pages
| Where | Change |
|---|---|
| Sidebar | "Fix Plan" item (Workspace), count badge = `awaitingDecision + regressed` |
| Dashboard | Replace the "Open priorities" tile with a **Fix Plan** tile: verified ring + "2 need your decision"; "Needs attention" rows link to the matching fix |
| Technical tab | Each failing check in the 8-check grid links to its fix (`problemKey` prefix → fix) |
| AI visibility tab | Each lost buyer question links to its `aeo.losing-prompt` fix |
| Reports | Later: "Fix Plan" section in the monthly report (reporting module follow-up) |
| Admin preview | New "Fix Plan" tab (read-only, same components) |

### 5.4 Components (portal style + Animate UI)
- `FixRow`, `FixGroup`, `ApprovalCard`, `ArtifactBlock`, `DoneWhen`,
  `FixTimeline` in `components/remediation/`, built on `components/portal/*`.
- Animate UI to add: **Copy Button** (`@animate-ui/components-buttons-copy`)
  for artifacts. Reuse Tabs (status filter), Sliding Number (counts), Highlight
  (row hover), Tooltip (what "verified" means), Shimmering Text ("Checking your
  site…" while verify runs).
- Copy rules (Rothenhall voice): no em dashes, no "rank", no guarantees;
  "verified" only when the backend says VERIFIED.

## 6. Phases

| # | Scope | Size | Done when |
|---|---|---|---|
| 0 | `ClientScopeGuard` on all `team/clients/:clientId` controllers + tests | S | A client user gets 404 on another client's routes in every module |
| 1 | Apply migration; Day-1 stage; auto-sync after audits; admin "Sync fix plan" button | M | A new project has a Fix Plan after Day-1 with no staff action |
| 2 | Backend client actions (§4.3), client projection (§4.4), summary fields (§4.5), permissions seed | M | Unit tests for each permission and transition; client never sees `llmDraft` unless shared |
| 3 | Frontend plumbing (§5.1) + Fix Plan page (CP06) read-only + sidebar item | M | Client sees their plan with real data |
| 4 | Fix detail (CP16): artifact + copy/download, done-when, timeline, export | M | Their developer can act from the page alone |
| 5 | Client actions in the UI: approval cards, "we've applied this", check now | S | Decision and applied flows work end to end, verifier result shown inline |
| 6 | Wiring (§5.3): dashboard tile, Technical/AI links, admin preview tab | S | Every finding in the portal has a path to its fix |
| 7 | Reporting "Fix Plan" section (reporting module) | S | Monthly report shows verified-since-baseline |

Phases 0 to 2 are backend and can run in parallel with 3 and 4 against the
existing read endpoints.

## 7. Testing
- **Backend:** guard spec (own client / other client / admin); controller specs
  for the new permissions; service specs for `client-applied` transitions,
  projection (no `llmDraft`, actor mapping) and verify rate limit.
- **Frontend:** lint + type check; a sample-data harness for each new screen
  (same technique used for the portal redesign); one live pass on a real
  project after Phase 1 (sync → view → mark applied → verified).
- **Live e2e** recorded in the remediation README, as every other module does.

## 8. Open decisions (need an answer before Phase 2)
1. **Can CLIENT_MEMBER approve decisions,** or only the POC? (Proposed: POC only.)
2. **Should clients see LLM drafts at all,** or only after staff "share" them? (Proposed: only shared.)
3. **Who is "on it" by default** for CODE fixes: the client's developer or
   Rothenhall (Eos later)? This changes the row label and the default CTA.
4. **Route name:** design plan says `/work/:workId`; this doc proposes
   `/plan/:fixId` so the URL matches the page name. Either is fine; pick one.
