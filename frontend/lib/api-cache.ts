/**
 * `apiFetch` — a drop-in for `fetch` in the `lib/*-api.ts` helpers that makes
 * the portal feel instant when moving between pages.
 *
 * Reads (GET with an Authorization header) are cached in memory, keyed by URL
 * and token:
 *   - younger than FRESH_MS  → answered from memory, no network;
 *   - younger than STALE_MS  → answered from memory at once, and refreshed in
 *     the background so the next visit is current (stale-while-revalidate);
 *   - older, or never seen   → fetched normally.
 * Identical reads in flight at the same time share one request (the sidebar
 * and a page both asking for the project list is one network call).
 *
 * Safety rules:
 *   - Any write (POST/PUT/PATCH/DELETE) clears the whole cache, so a change is
 *     never followed by stale data.
 *   - Only 2xx JSON responses are cached: errors and file downloads never are.
 *   - Memory only, never storage: a browser refresh always shows live data,
 *     and nothing about a client outlives the tab. Logout clears it too.
 *
 * @module lib/api-cache
 */

const FRESH_MS = 60_000;
const STALE_MS = 10 * 60_000;

interface Entry {
  status: number;
  headers: [string, string][];
  body: string;
  at: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry | null>>();

function authOf(init?: RequestInit): string | null {
  const headers = new Headers(init?.headers);
  return headers.get('authorization');
}

function keyOf(url: string, auth: string): string {
  return `${url}\n${auth}`;
}

function toResponse(entry: Entry): Response {
  return new Response(entry.body, { status: entry.status, headers: entry.headers });
}

/** Fetch and, if it is a cacheable success, store it. Resolves `null` for anything not cached. */
async function load(url: string, init: RequestInit | undefined, key: string): Promise<{ entry: Entry | null; response: Response }> {
  const response = await fetch(url, init);
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || !type.includes('application/json')) return { entry: null, response };
  const body = await response.text();
  // The stored body is already decoded text, so the transfer headers describing
  // the original bytes must not travel with the cached copy.
  const headers = [...response.headers.entries()].filter(([name]) => name !== 'content-length' && name !== 'content-encoding');
  const entry: Entry = { status: response.status, headers, body, at: Date.now() };
  cache.set(key, entry);
  return { entry, response: toResponse(entry) };
}

function revalidate(url: string, init: RequestInit | undefined, key: string): void {
  if (inflight.has(key)) return;
  const job = load(url, init, key)
    .then((r) => r.entry)
    .catch(() => null)
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
}

export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const auth = authOf(init);

  if (method !== 'GET') {
    const response = await fetch(url, init);
    clearApiCache();
    return response;
  }
  // `cache: 'no-store'` opts a read out: one-time values (an OAuth connect URL)
  // and live progress (the Day-1 pipeline) must always come from the server.
  if (!auth || init?.cache === 'no-store') return fetch(url, init);

  const key = keyOf(url, auth);
  const hit = cache.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;

  if (hit && age < FRESH_MS) return toResponse(hit);
  if (hit && age < STALE_MS) {
    revalidate(url, init, key);
    return toResponse(hit);
  }

  const pending = inflight.get(key);
  if (pending) {
    const entry = await pending;
    if (entry) return toResponse(entry);
  }

  let settle: (entry: Entry | null) => void = () => undefined;
  inflight.set(key, new Promise<Entry | null>((resolve) => (settle = resolve)));
  try {
    const { entry, response } = await load(url, init, key);
    settle(entry);
    return response;
  } catch (err) {
    settle(null);
    throw err;
  } finally {
    inflight.delete(key);
  }
}

/** Forget every cached read — after any write, and on logout. */
export function clearApiCache(): void {
  cache.clear();
}
