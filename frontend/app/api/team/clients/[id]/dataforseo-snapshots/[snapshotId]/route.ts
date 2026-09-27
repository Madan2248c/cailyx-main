import { NextResponse } from 'next/server';
import { authorizedBackendFetch, backendErrorToResponseInit } from '@/lib/backend-client';

type Params = { params: Promise<{ id: string; snapshotId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, snapshotId } = await params;
  try {
    const data = await authorizedBackendFetch(request, `/team/clients/${id}/dataforseo-snapshots/${snapshotId}`);
    return NextResponse.json(data);
  } catch (error) {
    const { body, status } = backendErrorToResponseInit(error);
    return NextResponse.json(body, { status });
  }
}
