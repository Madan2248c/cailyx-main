import { NextResponse } from 'next/server';
import { authorizedBackendFetch, backendErrorToResponseInit } from '@/lib/backend-client';

type Params = { params: Promise<{ id: string; projectId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, projectId } = await params;
  const search = new URL(request.url).searchParams;
  const propertyId = search.get('propertyId');
  const path =
    `/team/clients/${id}/projects/${projectId}/google/analytics` +
    (propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '');
  try {
    const data = await authorizedBackendFetch(request, path);
    return NextResponse.json(data);
  } catch (error) {
    const { body, status } = backendErrorToResponseInit(error);
    return NextResponse.json(body, { status });
  }
}
