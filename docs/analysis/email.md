# Analysis — `email` module

Status: **shipped 2026-09-27 — provider: Plunk.** `EmailModule` built, live-verified, and wired into `auth` (invite/resend/reset).

## What this closes

Flagged in `docs/analysis/reporting.md` and `docs/MODULES-STATUS.md`: no
email module exists in this rebuild. `auth`'s invite/reset links are
currently only `Logger.debug`-logged, and the Day-1 pipeline's "send the
client a magic link" step has nowhere to actually send from. This module
closes both.

## Tool choice

Operator decision (2026-09-27): **Plunk** — same provider the old
codebase used (`backend/src/modules/delivery/` there), not re-opened as a
3-way comparison since the choice was already made and the old
integration is a proven, working reference to port from.

## What changed vs. the old codebase

The old `delivery` module bundled three unrelated concerns together:
transactional email (Plunk), a Lead CRM with CTA logging, and a Stripe
Checkout upgrade ledger. This rebuild splits email out as its own small,
focused module — Lead CRM and billing are separate future decisions, not
part of getting a magic link into someone's inbox. Per `AGENTS.md`:
modules should have clear boundaries.

## Scope

A thin, generic transactional-email sender other modules call via
dependency injection (no new REST surface needed — nothing outside this
backend needs to trigger an email directly). Callers own their own
content (subject/HTML/text); this module owns only "does the send
actually happen, honestly."

## Implementation — ported from the old repo, unchanged

- **Raw `fetch` to `https://api.useplunk.com/v1/send`** — no SDK
  dependency, matching the old integration exactly. One fewer npm
  package to justify.
- **Honest guards** (kept verbatim):
  - No `PLUNK_SECRET_KEY` configured → `503 email-unconfigured`, nothing
    sent.
  - Plunk returns non-2xx or the request transport-fails → `503
    email-send-failed` — never a silent loss.

## Interface

```ts
interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface EmailService {
  send(input: SendEmailInput): Promise<{ sent: true; providerId: string }>;
}
```

No template engine inside this module — a caller (e.g. `auth`'s invite
flow, the future `day1-pipeline` orchestrator) composes its own
subject/HTML and calls `send()`. Keeps this module ignorant of what
everyone else is sending, which is what keeps it reusable.

## Immediate consumers (both existing gaps this closes)

1. **`auth`**: the invite/resend/password-reset flows currently only
   `Logger.debug`-log their links (per the module's own README). Once
   this module exists, those three call sites switch to
   `EmailService.send()` — this is a small follow-up patch to `auth`,
   not new scope for `auth` itself.
2. **`day1-pipeline`** (not yet built): its final step — "tell the client
   their Day-1 report is ready" — depends on this module existing. This
   was the literal blocker flagged when that flow was first discussed.

## Env vars

| Var | Notes |
|---|---|
| `PLUNK_SECRET_KEY` | enables the send path; unset → honest 503, ported behavior |
| `PLUNK_SENDER_EMAIL` | verified Plunk sender |

Add both to `.env` and `.env.example`.

## Entities

None. This module is stateless — it doesn't log or persist sends. If a
delivery ledger (did this email actually get opened, retried, etc.)
becomes necessary later, that's a deliberate future addition, not
included here to keep this module's first pass minimal.

## API

None (internal service only, no controller) — see "Scope" above for why.

## Dependencies

- **Modules**: none — this is itself a leaf dependency other modules
  import.
- **Consumers**: `auth` (immediate follow-up patch), `day1-pipeline`
  (blocking dependency, not yet built).
