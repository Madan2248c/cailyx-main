import { NextResponse } from 'next/server';
import { authorizedBackendFetch, backendErrorToResponseInit } from '@/lib/backend-client';

type Params = { params: Promise<{ id: string; projectId: string; competitorId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id, projectId, competitorId } = await params;
  const body = await request.json();
  try {
    const data = await authorizedBackendFetch(
      request,
      `/team/clients/${id}/projects/${projectId}/competitors/${competitorId}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
    return NextResponse.json(data);
  } catch (error) {
    const { body: errorBody, status } = backendErrorToResponseInit(error);
    return NextResponse.json(errorBody, { status });
  }
}
