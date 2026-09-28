import { NextResponse } from 'next/server';
import { authorizedBackendFetch, backendErrorToResponseInit } from '@/lib/backend-client';

type Params = { params: Promise<{ id: string; projectId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, projectId } = await params;
  const search = new URL(request.url).search;
  try {
    const data = await authorizedBackendFetch(request, `/team/clients/${id}/projects/${projectId}/remediation/fixes${search}`);
    return NextResponse.json(data);
  } catch (error) {
    const { body, status } = backendErrorToResponseInit(error);
    return NextResponse.json(body, { status });
  }
}
