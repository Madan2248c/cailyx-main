import { NextResponse } from 'next/server';
import { authorizedBackendFetch, backendErrorToResponseInit } from '@/lib/backend-client';

type Params = { params: Promise<{ id: string; projectId: string }> };

/** Staff only (the backend enforces ADMIN): re-enqueue a stalled or failed Day-1 pipeline. */
export async function POST(request: Request, { params }: Params) {
  const { id, projectId } = await params;
  try {
    const data = await authorizedBackendFetch(request, `/team/clients/${id}/projects/${projectId}/day1/retry`, { method: 'POST' });
    return NextResponse.json(data);
  } catch (error) {
    const { body, status } = backendErrorToResponseInit(error);
    return NextResponse.json(body, { status });
  }
}
