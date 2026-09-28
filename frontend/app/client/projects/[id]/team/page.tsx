'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/portal/button';
import { Card, CardContent } from '@/components/ui/card';
import { useClientProject } from '@/components/client/use-client-project';
import { TeamManagement } from '@/components/team/TeamManagement';
import { useAuth } from '@/contexts/auth-context';
import { PortalLoading } from '@/components/portal/states';

/** Team management as a workspace tab — rendered inside the client shell so the sidebar stays. */
export default function TeamPage() {
  const params = useParams<{ id: string }>();
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

  return <TeamManagement user={user} accessToken={accessToken} />;
}
