import { describe, expect, it } from 'vitest';
import { renderEmail } from './email-template.js';

const base = {
  heading: 'Welcome to Cailyx',
  paragraphs: ['Your account is ready.'],
  cta: { label: 'Set your password', url: 'https://cailyx.rothenhall.com/accept-invite?token=abc' },
};

describe('renderEmail', () => {
  it('prints the link on the button and again as plain text', () => {
    const html = renderEmail(base);
    expect(html.match(/accept-invite\?token=abc/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('Set your password');
  });

  it('escapes user-supplied text', () => {
    const html = renderEmail({ ...base, heading: '<script>x</script>', details: [{ label: 'Sign in with', value: 'a"b@c.com' }] });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a&quot;b@c.com');
  });

  it('renders the details box and footnote only when given', () => {
    expect(renderEmail(base)).not.toContain('Sign in with');
    const html = renderEmail({ ...base, details: [{ label: 'Sign in with', value: 'a@b.co' }], footnote: 'Expires in 72 hours.' });
    expect(html).toContain('Sign in with');
    expect(html).toContain('Expires in 72 hours.');
  });

  it('uses the link origin for the Rothenhall logo, and has a text fallback without one', () => {
    expect(renderEmail(base)).toContain('https://cailyx.rothenhall.com/brand/rothenhall-wordmark.png');
    expect(renderEmail({ ...base, cta: { label: 'Go', url: 'not a url' } })).toContain('ROTHENHALL PARTNERS');
  });
});
