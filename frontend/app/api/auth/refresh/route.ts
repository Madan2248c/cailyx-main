import { NextResponse } from 'next/server';
import { BackendError, backendFetch } from '@/lib/backend-client';
import { clearRefreshCookie, getRefreshCookie, setRefreshCookie } from '@/lib/refresh-cookie';
import type { AuthResponse } from '@/types/auth';

export async function POST() {
  const refreshToken = await getRefreshCookie();

  if (!refreshToken) {
    return NextResponse.json({ message: 'No session' }, { status: 401 });
  }

  try {
    const data = await backendFetch<AuthResponse & { refreshToken: string }>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });

    await setRefreshCookie(data.refreshToken);
    return NextResponse.json({ accessToken: data.accessToken, user: data.user });
  } catch (error) {
    await clearRefreshCookie();
    if (error instanceof BackendError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
  }
}
