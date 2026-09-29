import { NextResponse } from 'next/server';
import { authorizedBackendFetch, backendErrorToResponseInit } from '@/lib/backend-client';

type Params = { params: Promise<{ path: string[] }> };

/**
 * A pass-through to the backend's `/team/clients/...` API, used by the admin
 * preview for everything that has no dedicated route: run triggers, report
 * publishing, manual fixes, feature switches. It lives under its own
 * `/api/proxy` prefix so it can never shadow an explicit `/api/team` route.
 *
 * It adds no power of its own: the caller's own token is forwarded and the
 * backend's role and client-scope guards decide every request. The path is
 * limited to `clients/…`, and `backendFetch` rejects `..` segments.
 */
async function forward(request: Request, { params }: Params) {
  const { path } = await params;
  if (path[0] !== 'clients' || path.length < 2) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }
  const search = new URL(request.url).search;
  const hasBody = request.method !== 'GET' && request.method !== 'DELETE';
  const text = hasBody ? await request.text() : '';
  try {
    const data = await authorizedBackendFetch(request, `/team/${path.map(encodeURIComponent).join('/')}${search}`, {
      method: request.method,
      ...(text ? { body: text } : {}),
    });
    return NextResponse.json(data ?? null);
  } catch (error) {
    const { body, status } = backendErrorToResponseInit(error);
    return NextResponse.json(body, { status });
  }
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
