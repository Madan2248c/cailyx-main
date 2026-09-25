import { NextResponse } from 'next/server';
import { BackendError, backendFetch } from '@/lib/backend-client';
import { setRefreshCookie } from '@/lib/refresh-cookie';
import type { AuthResponse } from '@/types/auth';

export async function POST(request: Request) {
  const body = await request.json();

  try {
    const data = await backendFetch<AuthResponse & { refreshToken: string }>(
      '/auth/reset-password',
      { method: 'POST', body: JSON.stringify(body) },
    );

    await setRefreshCookie(data.refreshToken);
    return NextResponse.json({ accessToken: data.accessToken, user: data.user });
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
  }
}
