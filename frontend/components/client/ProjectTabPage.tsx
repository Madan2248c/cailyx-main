'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { useClientProject } from '@/components/client/use-client-project';
import { ComingSoon } from '@/components/client/ComingSoon';
import { PortalLoading } from '@/components/portal/states';

/** A project tab that isn't built yet: resolves the project, then a placeholder. */
export function ProjectTabPage({
  projectId,
  title,
  description,
}: {
  projectId: string;
  title: string;
  description: string;
}) {
  const { user, accessToken } = useAuth();
  const project = useClientProject(accessToken, user?.clientId ?? '', projectId);

  if (project === undefined) return <PortalLoading />;

  if (project === null) {
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

  return <ComingSoon title={`${project.name} — ${title}`} description={description} />;
}
