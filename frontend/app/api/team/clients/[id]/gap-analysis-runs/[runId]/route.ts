import { NextResponse } from 'next/server';
import { authorizedBackendFetch, backendErrorToResponseInit } from '@/lib/backend-client';

type Params = { params: Promise<{ id: string; runId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, runId } = await params;
  try {
    const data = await authorizedBackendFetch(request, `/team/clients/${id}/gap-analysis/runs/${runId}`);
    return NextResponse.json(data);
  } catch (error) {
    const { body, status } = backendErrorToResponseInit(error);
    return NextResponse.json(body, { status });
  }
}
