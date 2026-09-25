import { NextResponse } from 'next/server';
import { BackendError, backendFetch } from '@/lib/backend-client';

export async function GET(request: Request) {
  const authorization = request.headers.get('authorization');

  if (!authorization) {
    return NextResponse.json({ message: 'Missing token' }, { status: 401 });
  }

  try {
    const data = await backendFetch('/auth/me', { headers: { authorization } });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
  }
}
