import { NextResponse } from 'next/server';
import { authorizedBackendFetch, backendErrorToResponseInit } from '@/lib/backend-client';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const provider = new URL(request.url).searchParams.get('provider');
  try {
    const data = await authorizedBackendFetch(
      request,
      `/team/clients/${id}/google/connect-url?provider=${provider ?? ''}`,
    );
    return NextResponse.json(data);
  } catch (error) {
    const { body, status } = backendErrorToResponseInit(error);
    return NextResponse.json(body, { status });
  }
}
