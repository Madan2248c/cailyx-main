/**
 * Shared HTML layout for Cailyx transactional emails: one branded, table-based
 * (email-client safe) shell so invite, ready and reset mails look the same.
 * Callers pass plain strings; the link is also printed in full so it still
 * works when a client strips the button.
 *
 * @module email/email-template
 */

export interface EmailLayoutInput {
  /** Short headline shown at the top of the card. */
  heading: string;
  /** Body paragraphs (plain text, escaped here). */
  paragraphs: string[];
  /** The one action the email exists for. */
  cta: { label: string; url: string };
  /** Small print under the button (expiry, "ignore if unexpected"). */
  footnote?: string;
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderEmail({ heading, paragraphs, cta, footnote }: EmailLayoutInput): string {
  const url = escapeHtml(cta.url);
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#313337;">${escapeHtml(p)}</p>`)
    .join('');
  return (
    `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 12px;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e6e6e8;border-radius:12px;">` +
    `<tr><td style="padding:28px 32px 8px;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;letter-spacing:0.08em;color:#313337;">CAILYX</td></tr>` +
    `<tr><td style="padding:8px 32px 0;font-family:Arial,Helvetica,sans-serif;">` +
    `<h1 style="margin:0 0 14px;font-size:20px;line-height:1.3;color:#313337;">${escapeHtml(heading)}</h1>` +
    body +
    `<p style="margin:22px 0;"><a href="${url}" style="display:inline-block;background:#313337;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px;">${escapeHtml(cta.label)}</a></p>` +
    `<p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:#6b6c70;">Button not working? Copy this link into your browser:<br><a href="${url}" style="color:#6b6c70;word-break:break-all;">${url}</a></p>` +
    (footnote ? `<p style="margin:0 0 20px;font-size:12px;line-height:1.5;color:#6b6c70;">${escapeHtml(footnote)}</p>` : '') +
    `</td></tr>` +
    `<tr><td style="padding:16px 32px 24px;border-top:1px solid #e6e6e8;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6b6c70;">Delivered by Rothenhall Partners</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}
