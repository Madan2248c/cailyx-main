import { NextResponse } from 'next/server';
import { authorizedBackendFetch, backendErrorToResponseInit } from '@/lib/backend-client';

type Params = { params: Promise<{ id: string; projectId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, projectId } = await params;
  const body = await request.json();
  try {
    const data = await authorizedBackendFetch(
      request,
      `/team/clients/${id}/projects/${projectId}/competitors/manual`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    const { body: errorBody, status } = backendErrorToResponseInit(error);
    return NextResponse.json(errorBody, { status });
  }
}
