'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { PageLoadingState } from '@/components/ui/skeleton';
import { TeamManagement } from '@/components/team/TeamManagement';
import { useAuth } from '@/contexts/auth-context';

/**
 * The standalone `/team` page, still linked from `/dashboard`'s "Manage team".
 *
 * Inside the workspace the sidebar opens `/client/projects/[id]/team` instead,
 * which renders the same `TeamManagement` screen within the client shell.
 */
export default function StandaloneTeamPage() {
  const { user, accessToken, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && (!user || user.role !== 'CLIENT_POC')) {
      router.replace('/dashboard');
    }
  }, [isLoading, user, router]);

  if (isLoading || !user || !accessToken || user.role !== 'CLIENT_POC') {
    return (
      <div className="flex flex-1 flex-col px-4 py-10">
        <PageLoadingState message="Loading your team…" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-6xl px-5 pt-6 md:px-8">
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/client">← Back to projects</Link>} />
      </div>
      <TeamManagement user={user} accessToken={accessToken} />
    </div>
  );
}
