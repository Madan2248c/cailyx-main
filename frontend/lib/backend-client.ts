/**
 * Where the NestJS API lives. Localhost is only a development default: in
 * production a missing BACKEND_URL is a deploy mistake, so fail loudly
 * instead of quietly calling localhost.
 */
export function backendUrl(): string {
  const url = process.env.BACKEND_URL;
  if (url) return url.replace(/\/+$/, '');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('BACKEND_URL is not set. Set it to the API base URL (e.g. https://api.example.com).');
  }
  return 'http://localhost:3001';
}

export class BackendError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : 'Backend request failed',
    );
  }
}

/**
 * Em and en dashes read as clutter in the portal, and older stored text
 * (reports, narratives, page titles) still has them. Every backend response
 * passes through here, so they're swapped for a comma once, in one place.
 * Ranges like "2–3" (no spaces) are kept. File contents a client will
 * paste into their site ("content") are left byte-for-byte.
 */
function withoutDashes(text: string): string {
  if (!text.includes('—') && !text.includes('–')) return text;
  return text
    .replace(/\s*—\s*/g, ', ')
    .replace(/(\S)\s+–\s+(\S)/g, '$1, $2')
    .replace(/^, /, '')
    .replace(/,\s*([,.;:!?])/g, '$1');
}

function cleanDashes(value: unknown, key?: string): unknown {
  if (typeof value === 'string') return key === 'content' ? value : withoutDashes(value);
  if (Array.isArray(value)) return value.map((item) => cleanDashes(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanDashes(v, k)]));
  }
  return value;
}

/** Server-side only: calls the NestJS backend directly. Never import this from a Client Component. */
export async function backendFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Route params are decoded before they reach the proxy routes, so an id
  // like "x%2F..%2Fadmin" would otherwise climb out of its path here.
  if (/(^|\/)\.{1,2}(\/|\?|$)/.test(path) || path.includes('\\')) {
    throw new BackendError(400, { message: 'Invalid path' });
  }
  const response = await fetch(`${backendUrl()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  const body = cleanDashes(await response.json().catch(() => undefined));

  if (!response.ok) {
    throw new BackendError(response.status, body);
  }

  return body as T;
}

/**
 * Forwards the incoming request's Authorization header to the backend.
 * Used by every /api/team/* route — those calls carry the caller's access
 * token (held in the client's memory, not a cookie), unlike the /api/auth/*
 * routes that manage the refresh-token cookie instead.
 */
export async function authorizedBackendFetch<T>(
  request: Request,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const authorization = request.headers.get('authorization');
  if (!authorization) {
    throw new BackendError(401, { message: 'Missing token' });
  }
  return backendFetch<T>(path, { ...init, headers: { authorization, ...init?.headers } });
}

/** Turns a BackendError (or anything else) into the right NextResponse for a route handler to return. */
export function backendErrorToResponseInit(error: unknown): { body: unknown; status: number } {
  if (error instanceof BackendError) {
    return { body: error.body, status: error.status };
  }
  return { body: { message: 'Unexpected error' }, status: 500 };
}
