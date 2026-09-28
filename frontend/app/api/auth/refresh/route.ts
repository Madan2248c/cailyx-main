import { NextResponse } from 'next/server';
import { BackendError, backendFetch } from '@/lib/backend-client';
import { clearRefreshCookie, getRefreshCookie, setRefreshCookie } from '@/lib/refresh-cookie';
import type { AuthResponse } from '@/types/auth';

export async function POST() {
  const refreshToken = await getRefreshCookie();

  // No cookie is the normal signed-out state, not a failure: answering 200
  // with a null session keeps every signed-out page load (login, reset,
  // invite) from logging a 401 in the browser console. A cookie that fails
  // to refresh below is a real failure and still returns the error status.
  if (!refreshToken) {
    return NextResponse.json({ accessToken: null, user: null });
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
