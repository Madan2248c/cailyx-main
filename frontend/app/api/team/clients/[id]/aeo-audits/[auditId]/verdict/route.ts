import { NextResponse } from 'next/server';
import { authorizedBackendFetch, backendErrorToResponseInit } from '@/lib/backend-client';

type Params = { params: Promise<{ id: string; auditId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, auditId } = await params;
  try {
    const data = await authorizedBackendFetch(
      request,
      `/team/clients/${id}/aeo-audits/${auditId}/verdict`,
    );
    return NextResponse.json(data);
  } catch (error) {
    const { body, status } = backendErrorToResponseInit(error);
    return NextResponse.json(body, { status });
  }
}
