const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';

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

/** Server-side only — calls the NestJS backend directly. Never import this from a Client Component. */
export async function backendFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  const body = await response.json().catch(() => undefined);

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
