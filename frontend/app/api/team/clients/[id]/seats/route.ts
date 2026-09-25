import { NextResponse } from 'next/server';
import { authorizedBackendFetch, backendErrorToResponseInit } from '@/lib/backend-client';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  try {
    const data = await authorizedBackendFetch(request, `/team/clients/${id}/seats`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return NextResponse.json(data);
  } catch (error) {
    const { body: errorBody, status } = backendErrorToResponseInit(error);
    return NextResponse.json(errorBody, { status });
  }
}
