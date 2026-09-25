import { NextResponse } from 'next/server';
import { BackendError, backendFetch } from '@/lib/backend-client';

export async function POST(request: Request) {
  const body = await request.json();

  try {
    const data = await backendFetch('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
  }
}
