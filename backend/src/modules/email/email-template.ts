/**
 * Shared HTML layout for every Cailyx transactional email (invite, "audit is
 * ready", password reset), so they all look and read the same.
 *
 * Built for inboxes, not browsers: table layout and inline styles (Gmail,
 * Outlook, Apple Mail), one clear action, real text around it (mail that is
 * only a button and an image is filtered harder), a hidden preheader, the full
 * link printed under the button, and no tracking pixels or link shorteners.
 * Nothing secret is ever put in the email itself, only a one-time link.
 *
 * @module email/email-template
 */

export interface EmailLayoutInput {
  /** Headline at the top of the card. */
  heading: string;
  /** Body paragraphs (plain text, escaped here). */
  paragraphs: string[];
  /** The one action the email exists for. */
  cta: { label: string; url: string };
  /** Optional label/value rows shown in a small "details" box (e.g. the sign-in address). */
  details?: Array<{ label: string; value: string }>;
  /** Small print under the button (expiry, "ignore if unexpected"). */
  footnote?: string;
  /** Hidden inbox-preview line; defaults to the first paragraph. */
  preheader?: string;
}

const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const INK = '#313337';
const MUTED = '#5b5e62';
const LINE = '#ebebec';
const SAND = '#f9f9f9';
const CARD = '#fefefe';
const ACCENT = '#CDB897'; // Cailyx mark tan; #84684D is its deep brown

/** "https://cailyx.rothenhall.com/x?y" → "https://cailyx.rothenhall.com" (empty if unparsable). */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export function renderEmail({ heading, paragraphs, cta, details, footnote, preheader }: EmailLayoutInput): string {
  const url = esc(cta.url);
  const origin = originOf(cta.url);
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:${INK};">${esc(p)}</p>`)
    .join('');
  const detailsBox =
    details && details.length > 0
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SAND};border:1px solid ${LINE};border-radius:12px;margin:0 0 24px;"><tr><td style="padding:16px 20px;font-family:${SANS};">` +
        `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:14px;line-height:1.55;">` +
        details
          .map(
            (d) =>
              `<tr><td style="color:${MUTED};padding:2px 0;width:96px;vertical-align:top;">${esc(d.label)}</td><td style="color:${INK};font-weight:600;padding:2px 0;">${esc(d.value)}</td></tr>`,
          )
          .join('') +
        `</table></td></tr></table>`
      : '';
  const logo = origin
    ? `<img src="${esc(origin)}/brand/rothenhall-wordmark.png" width="140" alt="Rothenhall Partners" style="display:inline-block;border:0;height:auto;">`
    : `<span style="font-family:${SERIF};font-size:16px;color:${INK};letter-spacing:0.06em;">ROTHENHALL PARTNERS</span>`;
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(heading)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f4f4f5;">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader ?? paragraphs[0] ?? heading)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;"><tr><td align="center" style="padding:32px 14px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${CARD};border-radius:16px;overflow:hidden;border:1px solid ${LINE};">` +
    // header band
    `<tr><td align="center" style="background:${INK};padding:30px 32px 26px;">` +
    `<div style="font-family:${SERIF};font-size:28px;font-weight:700;letter-spacing:0.14em;color:#ffffff;line-height:1;">CAILYX</div>` +
    `<div style="font-family:${SANS};font-size:11px;letter-spacing:0.28em;color:${ACCENT};text-transform:uppercase;margin-top:10px;">Client portal</div>` +
    `</td></tr>` +
    // body
    `<tr><td style="padding:34px 38px 6px;font-family:${SANS};">` +
    `<h1 style="margin:0 0 16px;font-family:${SERIF};font-size:26px;line-height:1.25;font-weight:700;color:${INK};">${esc(heading)}</h1>` +
    body +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td align="center" style="background:${INK};border-radius:10px;">` +
    `<a href="${url}" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">${esc(cta.label)}</a>` +
    `</td></tr></table>` +
    detailsBox +
    `<p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:${MUTED};">Button not working? Copy this link into your browser:<br><a href="${url}" style="color:${MUTED};word-break:break-all;">${url}</a></p>` +
    (footnote ? `<p style="margin:0 0 26px;font-size:13px;line-height:1.6;color:${MUTED};">${esc(footnote)}</p>` : '<div style="height:20px;"></div>') +
    `</td></tr>` +
    // footer
    `<tr><td align="center" style="padding:22px 32px 26px;border-top:1px solid ${LINE};font-family:${SANS};background:${SAND};">` +
    `<div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${MUTED};margin-bottom:10px;">Delivered by</div>` +
    logo +
    `<div style="font-size:12px;line-height:1.6;color:${MUTED};margin-top:12px;">You are receiving this because of activity on your Cailyx account.<br>This is an automated message, so please do not reply to it.</div>` +
    `</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}
