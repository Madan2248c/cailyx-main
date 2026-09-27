'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';

/** Gates the client portal: signed-in client users only (ADMIN has no client to show). */
export function ClientGate({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
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

  if (!user.clientId) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col gap-4 pt-6">
            <p className="text-sm text-muted-foreground">
              The client portal is for client accounts — admins don&apos;t belong to one.
            </p>
            <Button variant="secondary" nativeButton={false} render={<Link href="/dashboard">Back to dashboard</Link>} />
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
