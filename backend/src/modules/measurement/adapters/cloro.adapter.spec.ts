import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { CloroAdapterError, CloroClient } from './cloro.adapter.js';

function config(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('CloroClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('throws cloro-disabled when no key is configured — never touches the network', async () => {
    const client = new CloroClient(config({}));
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    await expect(client.runTask('cloro_chatgpt', 'CHATGPT', {})).rejects.toMatchObject({ reason: 'cloro-disabled' } as Partial<CloroAdapterError>);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('submits, polls to COMPLETED, and returns the response', async () => {
    const client = new CloroClient(config({ CLORO_API_KEY: 'k1' }));
    let pollCount = 0;
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/v1/async/task') && !url.includes('/task/')) {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, task: { id: 't1', status: 'QUEUED' }, credits: { creditsToCharge: 5, creditsCharged: null } }), { status: 200 }),
        );
      }
      pollCount++;
      const status = pollCount < 2 ? 'PROCESSING' : 'COMPLETED';
      return Promise.resolve(
        new Response(
          JSON.stringify({
            task: { id: 't1', status },
            credits: { creditsToCharge: 5, creditsCharged: status === 'COMPLETED' ? 5 : null },
            response: status === 'COMPLETED' ? { text: 'answer', sources: [] } : undefined,
          }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;

    const result = await client.runTask('cloro_chatgpt', 'CHATGPT', { prompt: 'hi' });
    expect(result.task.status).toBe('COMPLETED');
    expect(result.response).toEqual({ text: 'answer', sources: [] });
  }, 15000);

  it('falls through to the next key when the first is rejected', async () => {
    const client = new CloroClient(config({ CLORO_API_KEY: 'bad', CLORO_API_KEY1: 'good' }));
    const calls: string[] = [];
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? '';
      calls.push(auth);
      if (auth.includes('bad')) {
        return Promise.resolve(new Response('unauthorized', { status: 401 }));
      }
      if (url.includes('/task/')) {
        return Promise.resolve(
          new Response(JSON.stringify({ task: { id: 't1', status: 'COMPLETED' }, credits: { creditsToCharge: 5, creditsCharged: 5 }, response: { text: 'ok', sources: [] } }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, task: { id: 't1', status: 'QUEUED' }, credits: { creditsToCharge: 5, creditsCharged: null } }), { status: 200 }),
      );
    }) as unknown as typeof fetch;

    const result = await client.runTask('cloro_chatgpt', 'CHATGPT', {});
    expect(result.task.status).toBe('COMPLETED');
    expect(calls.some((a) => a.includes('bad'))).toBe(true);
    expect(calls.some((a) => a.includes('good'))).toBe(true);
  }, 15000);

  it('throws cloro-api-error when every configured key fails', async () => {
    const client = new CloroClient(config({ CLORO_API_KEY: 'bad1' }));
    global.fetch = vi.fn(() => Promise.resolve(new Response('nope', { status: 401 }))) as unknown as typeof fetch;
    await expect(client.runTask('cloro_chatgpt', 'CHATGPT', {})).rejects.toMatchObject({ reason: 'cloro-api-error' } as Partial<CloroAdapterError>);
  });

  it('throws cloro-task-failed when the task status is FAILED', async () => {
    const client = new CloroClient(config({ CLORO_API_KEY: 'k1' }));
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/task/')) {
        return Promise.resolve(new Response(JSON.stringify({ task: { id: 't1', status: 'FAILED' }, credits: { creditsToCharge: 5, creditsCharged: 0 } }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true, task: { id: 't1', status: 'QUEUED' }, credits: { creditsToCharge: 5, creditsCharged: null } }), { status: 200 }));
    }) as unknown as typeof fetch;
    await expect(client.runTask('cloro_chatgpt', 'CHATGPT', {})).rejects.toMatchObject({ reason: 'cloro-task-failed' } as Partial<CloroAdapterError>);
  }, 15000);

  it('sums credits across every configured key, treating a failing key as 0', async () => {
    const client = new CloroClient(config({ CLORO_API_KEY: 'k1', CLORO_API_KEY1: 'k2' }));
    global.fetch = vi.fn((_url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? '';
      if (auth.includes('k1')) return Promise.resolve(new Response(JSON.stringify({ remaining: 100 }), { status: 200 }));
      return Promise.resolve(new Response('error', { status: 500 }));
    }) as unknown as typeof fetch;
    expect(await client.getRemainingCredits()).toBe(100);
  });
});
