import { NextResponse } from 'next/server';
import { authorizedBackendFetch, backendErrorToResponseInit } from '@/lib/backend-client';

type Params = { params: Promise<{ id: string; fixId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, fixId } = await params;
  const text = await request.text();
  try {
    const data = await authorizedBackendFetch(request, `/team/clients/${id}/remediation/fixes/${fixId}/client-applied`, {
      method: 'POST',
      ...(text ? { body: text } : {}),
    });
    return NextResponse.json(data);
  } catch (error) {
    const { body, status } = backendErrorToResponseInit(error);
    return NextResponse.json(body, { status });
  }
}
