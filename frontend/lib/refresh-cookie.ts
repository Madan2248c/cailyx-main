import { cookies } from 'next/headers';

const COOKIE_NAME = 'cailyx_refresh_token';
// Mirrors backend/.env REFRESH_TOKEN_TTL_DAYS. Not security-critical if this
// drifts slightly — the backend's own expires_at column is the source of truth.
const REFRESH_TOKEN_TTL_DAYS = 30;

export async function setRefreshCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  });
}

export async function getRefreshCookie(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value;
}

export async function clearRefreshCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
