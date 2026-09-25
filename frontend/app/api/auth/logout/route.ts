import { NextResponse } from 'next/server';
import { backendFetch } from '@/lib/backend-client';
import { clearRefreshCookie, getRefreshCookie } from '@/lib/refresh-cookie';

export async function POST() {
  const refreshToken = await getRefreshCookie();

  if (refreshToken) {
    await backendFetch('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
  }

  await clearRefreshCookie();
  return NextResponse.json({ success: true });
}
