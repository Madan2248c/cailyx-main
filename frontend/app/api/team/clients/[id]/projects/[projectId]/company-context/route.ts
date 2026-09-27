import { NextResponse } from 'next/server';
import { authorizedBackendFetch, backendErrorToResponseInit } from '@/lib/backend-client';

type Params = { params: Promise<{ id: string; projectId: string }> };

function backendPath(id: string, projectId: string) {
  return `/team/clients/${id}/projects/${projectId}/company-context`;
}

export async function GET(request: Request, { params }: Params) {
  const { id, projectId } = await params;
  try {
    const data = await authorizedBackendFetch(request, backendPath(id, projectId));
    return NextResponse.json(data);
  } catch (error) {
    const { body, status } = backendErrorToResponseInit(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const { id, projectId } = await params;
  const body = await request.json();
  try {
    const data = await authorizedBackendFetch(request, backendPath(id, projectId), {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return NextResponse.json(data);
  } catch (error) {
    const { body: errorBody, status } = backendErrorToResponseInit(error);
    return NextResponse.json(errorBody, { status });
  }
}
