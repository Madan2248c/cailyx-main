/**
 * Email Service — thin, generic transactional-email sender other modules call
 * via dependency injection. No controller, no persistence, no templates.
 *
 * Provider: Plunk (`POST https://next-api.useplunk.com/v1/send`, raw `fetch`,
 * no SDK — ported from the old repo's `delivery` module, which used the
 * previous `https://api.useplunk.com` base that now returns 401).
 *
 * Live-verified 2026-09-27: the current Plunk API **requires** `from` (an
 * address on a verified domain) unless the send references a template that
 * already carries one. This service always sends inline subject+body, so it
 * always sends `from`, read from `PLUNK_SENDER_EMAIL`. Verified sender
 * domain for this project: `rothenhall.com`.
 *
 * Plunk generates the plain-text alternative from the HTML body itself, so
 * there is no plain-text field on the wire — `text` is accepted on the input
 * for forward-compat and otherwise ignored.
 *
 * Honest guards (same posture as the old integration):
 *  - No `PLUNK_SECRET_KEY` or no `PLUNK_SENDER_EMAIL` → 503
 *    `email-unconfigured`, nothing sent.
 *  - Plunk returns non-2xx or the request transport-fails → 503
 *    `email-send-failed` — never a silent loss.
 *
 * See docs/analysis/email.md.
 *
 * @module email/email.service
 */

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const PLUNK_SEND_URL = 'https://next-api.useplunk.com/v1/send';

/** What a caller sends — the caller owns subject/HTML, this module owns delivery. */
export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  /** Accepted for forward-compat; Plunk auto-generates plaintext from `html`. */
  text?: string;
}

export interface EmailSendResult {
  sent: true;
  /** Plunk email record ID (correlates with webhook events as `emailId`). */
  providerId: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {}

  /** False when sending would throw `email-unconfigured` — lets callers report honestly. */
  isConfigured(): boolean {
    return Boolean(this.config.get<string>('PLUNK_SECRET_KEY')) && Boolean(this.config.get<string>('PLUNK_SENDER_EMAIL'));
  }

  async send(input: SendEmailInput): Promise<EmailSendResult> {
    const apiKey = this.config.get<string>('PLUNK_SECRET_KEY');
    const sender = this.config.get<string>('PLUNK_SENDER_EMAIL');
    if (!apiKey || !sender) {
      throw new ServiceUnavailableException(
        'email-unconfigured: PLUNK_SECRET_KEY / PLUNK_SENDER_EMAIL is not set — nothing was sent',
      );
    }

    let res: Response;
    try {
      res = await fetch(PLUNK_SEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          to: input.to,
          from: sender,
          subject: input.subject,
          body: input.html,
        }),
      });
    } catch (err) {
      throw new ServiceUnavailableException(`email-send-failed: ${(err as Error).message}`);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.error(`Plunk send failed (${res.status}): ${detail.slice(0, 300)}`);
      throw new ServiceUnavailableException(`email-send-failed: Plunk returned ${res.status}`);
    }

    const json = (await res.json().catch(() => ({}))) as {
      data?: { emails?: Array<{ email?: string }> };
    };
    const providerId = json.data?.emails?.[0]?.email ?? 'unknown';
    this.logger.log(`Email sent to ${input.to} (providerId ${providerId})`);
    return { sent: true, providerId };
  }
}
