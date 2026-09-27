import { NextResponse } from 'next/server';
import { authorizedBackendFetch, backendErrorToResponseInit } from '@/lib/backend-client';

type Params = { params: Promise<{ id: string; projectId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, projectId } = await params;
  try {
    const data = await authorizedBackendFetch(
      request,
      `/team/clients/${id}/projects/${projectId}/technical-audit-schedule`,
    );
    return NextResponse.json(data);
  } catch (error) {
    const { body, status } = backendErrorToResponseInit(error);
    return NextResponse.json(body, { status });
  }
}

export async function PUT(request: Request, { params }: Params) {
  const { id, projectId } = await params;
  const body = await request.json();
  try {
    const data = await authorizedBackendFetch(
      request,
      `/team/clients/${id}/projects/${projectId}/technical-audit-schedule`,
      { method: 'PUT', body: JSON.stringify(body) },
    );
    return NextResponse.json(data);
  } catch (error) {
    const { body: errorBody, status } = backendErrorToResponseInit(error);
    return NextResponse.json(errorBody, { status });
  }
}
