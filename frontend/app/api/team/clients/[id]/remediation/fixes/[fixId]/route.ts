import { NextResponse } from 'next/server';
import { authorizedBackendFetch, backendErrorToResponseInit } from '@/lib/backend-client';

type Params = { params: Promise<{ id: string; fixId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, fixId } = await params;
  try {
    const data = await authorizedBackendFetch(request, `/team/clients/${id}/remediation/fixes/${fixId}`);
    return NextResponse.json(data);
  } catch (error) {
    const { body, status } = backendErrorToResponseInit(error);
    return NextResponse.json(body, { status });
  }
}
