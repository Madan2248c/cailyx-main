import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service.js';

function config(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const FULL = { PLUNK_SECRET_KEY: 'sk_test', PLUNK_SENDER_EMAIL: 'noreply@rothenhall.com' };

function okResponse(providerId = 'mail_123'): Response {
  return new Response(JSON.stringify({ success: true, data: { emails: [{ email: providerId }] } }), {
    status: 200,
  });
}

describe('EmailService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('throws email-unconfigured when no key is set — never touches the network', async () => {
    const service = new EmailService(config({ PLUNK_SENDER_EMAIL: 'noreply@rothenhall.com' }));
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    await expect(service.send({ to: 'a@b.com', subject: 's', html: '<p>hi</p>' })).rejects.toThrow(
      /email-unconfigured/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws email-unconfigured when no sender is set — never touches the network', async () => {
    const service = new EmailService(config({ PLUNK_SECRET_KEY: 'sk_test' }));
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    await expect(service.send({ to: 'a@b.com', subject: 's', html: '<p>hi</p>' })).rejects.toThrow(
      /email-unconfigured/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends to, from, subject, body and returns the provider id', async () => {
    const service = new EmailService(config(FULL));
    let seenBody: Record<string, unknown> = {};
    global.fetch = vi.fn((_url: string, init?: RequestInit) => {
      seenBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return Promise.resolve(okResponse('mail_abc'));
    }) as unknown as typeof fetch;

    const result = await service.send({ to: 'user@example.com', subject: 'Hello', html: '<p>Hi</p>' });

    expect(result).toEqual({ sent: true, providerId: 'mail_abc' });
    expect(seenBody).toMatchObject({
      to: 'user@example.com',
      from: 'noreply@rothenhall.com',
      name: 'Cailyx',
      subject: 'Hello',
      body: '<p>Hi</p>',
    });
  });

  it('throws email-send-failed when Plunk returns non-2xx', async () => {
    const service = new EmailService(config(FULL));
    global.fetch = vi.fn(() => Promise.resolve(new Response('bad', { status: 422 }))) as unknown as typeof fetch;
    await expect(service.send({ to: 'a@b.com', subject: 's', html: '<p>hi</p>' })).rejects.toThrow(
      /email-send-failed/,
    );
  });

  it('throws email-send-failed when the transport fails', async () => {
    const service = new EmailService(config(FULL));
    global.fetch = vi.fn(() => Promise.reject(new Error('down'))) as unknown as typeof fetch;
    await expect(service.send({ to: 'a@b.com', subject: 's', html: '<p>hi</p>' })).rejects.toThrow(
      /email-send-failed/,
    );
  });

  it('isConfigured reflects both vars', () => {
    expect(new EmailService(config(FULL)).isConfigured()).toBe(true);
    expect(new EmailService(config({})).isConfigured()).toBe(false);
    expect(new EmailService(config({ PLUNK_SECRET_KEY: 'x' })).isConfigured()).toBe(false);
  });
});
