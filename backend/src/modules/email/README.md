# Email module

Thin, generic transactional-email sender over Plunk. Internal service only —
no controller, no persistence, no templates. Other modules import
`EmailModule` and call `EmailService.send()`; each caller owns its own
subject/HTML.

Spec: `docs/analysis/email.md`. Ported from the old repo's
`delivery` module (email half only — Lead CRM and Stripe are separate future
decisions).

## What changed vs. the old integration (live-verified 2026-09-27)

- Base URL is now **`https://next-api.useplunk.com/v1/send`**. The old
  `https://api.useplunk.com/v1/send` returns 401.
- **`from` is required** on every send (verified-domain address). The old API
  fell back to the project default when omitted; the new one 422s. This
  service always sends `from: PLUNK_SENDER_EMAIL`.
- `body` carries the HTML; Plunk generates the plaintext alternative itself.

## Public API

```ts
send({ to, subject, html, text? }: SendEmailInput): Promise<{ sent: true; providerId: string }>
isConfigured(): boolean
```

Guards (never a silent loss):

| State | Behaviour |
|---|---|
| `PLUNK_SECRET_KEY` or `PLUNK_SENDER_EMAIL` unset | 503 `email-unconfigured`, no network call |
| Plunk non-2xx or transport failure | 503 `email-send-failed` |

## Env vars

| Var | Notes |
|---|---|
| `PLUNK_SECRET_KEY` | enables the send path; unset → honest 503 |
| `PLUNK_SENDER_EMAIL` | verified-sender address, e.g. `noreply@rothenhall.com` (`rothenhall.com` verified 2026-09-27) |

## Dependencies

- Modules: none (leaf).
- Consumers: `auth` (invite/resend/reset links, wired 2026-09-27), `day1-pipeline` (not yet built).

## Testing

- `email.service.spec.ts` (6 tests, mocked `fetch`): unconfigured × 2, wire shape, non-2xx, transport failure, `isConfigured`.
- Live send verified 2026-09-27 via curl (`success: true`, delivery confirmed in inbox).
