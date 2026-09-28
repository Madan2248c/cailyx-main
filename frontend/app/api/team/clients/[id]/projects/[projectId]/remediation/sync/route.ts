import { NextResponse } from 'next/server';
import { authorizedBackendFetch, backendErrorToResponseInit } from '@/lib/backend-client';

type Params = { params: Promise<{ id: string; projectId: string }> };

/** Staff only (the backend enforces ADMIN): rebuild the Fix Plan from the latest audits. */
export async function POST(request: Request, { params }: Params) {
  const { id, projectId } = await params;
  try {
    const data = await authorizedBackendFetch(request, `/team/clients/${id}/projects/${projectId}/remediation/sync`, { method: 'POST' });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    const { body, status } = backendErrorToResponseInit(error);
    return NextResponse.json(body, { status });
  }
}
