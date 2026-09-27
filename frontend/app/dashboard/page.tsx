'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Admin',
  CLIENT_POC: 'Client POC',
  CLIENT_MEMBER: 'Client Member',
};

export default function DashboardPage() {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [isLoading, user, router]);

  if (isLoading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Welcome back</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Email</dt>
              <dd>{user.email}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Role</dt>
              <dd>{ROLE_LABEL[user.role] ?? user.role}</dd>
            </div>
          </dl>
          {user.role === 'ADMIN' ? (
            <Button
              variant="secondary"
              nativeButton={false}
              render={<Link href="/admin/clients">Manage clients</Link>}
            />
          ) : null}
          {user.role === 'CLIENT_POC' || user.role === 'CLIENT_MEMBER' ? (
            <Button
              variant="secondary"
              nativeButton={false}
              render={<Link href="/client">Open workspace</Link>}
            />
          ) : null}
          {user.role === 'CLIENT_POC' ? (
            <Button
              variant="secondary"
              nativeButton={false}
              render={<Link href="/team">Manage team</Link>}
            />
          ) : null}
          {user.role === 'CLIENT_POC' || user.role === 'CLIENT_MEMBER' ? (
            <Button
              variant="secondary"
              nativeButton={false}
              render={<Link href="/onboarding">Review company details</Link>}
            />
          ) : null}
          <Button variant="outline" onClick={handleLogout}>
            Log out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
