import { redirect } from 'next/navigation';
import { getRefreshCookie } from '@/lib/refresh-cookie';

export default async function Home() {
  const refreshToken = await getRefreshCookie();
  redirect(refreshToken ? '/dashboard' : '/login');
}
