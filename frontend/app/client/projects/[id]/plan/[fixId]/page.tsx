'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/portal/button';
import { Card, CardContent } from '@/components/ui/card';
import { FixDetail } from '@/components/remediation/FixDetail';
import { useClientProject } from '@/components/client/use-client-project';
import { useAuth } from '@/contexts/auth-context';
import { PortalLoading } from '@/components/portal/states';

/** CP16 Work handoff: one fix, everything needed to act on it. */
export default function FixDetailPage() {
  const params = useParams<{ id: string; fixId: string }>();
  const { user, accessToken } = useAuth();
  const project = useClientProject(accessToken, user?.clientId ?? '', params.id);

  if (project === undefined) return <PortalLoading />;

  if (project === null || !user || !accessToken || !user.clientId) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col gap-4 pt-6">
            <p className="text-sm text-muted-foreground">
              This project doesn&apos;t exist or doesn&apos;t belong to your account.
            </p>
            <Button variant="secondary" nativeButton={false} render={<Link href="/client">Back to projects</Link>} />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <FixDetail
      accessToken={accessToken}
      clientId={user.clientId}
      projectId={project.id}
      fixId={params.fixId}
      canDecide={user.role === 'CLIENT_POC' || user.role === 'ADMIN'}
    />
  );
}
