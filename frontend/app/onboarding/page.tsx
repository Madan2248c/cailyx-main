'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/portal/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { useAuth } from '@/contexts/auth-context';
import {
  getCompanyContext,
  listCompetitors,
  listSocialProfiles,
} from '@/lib/onboarding-api';
import { listProjects } from '@/lib/projects-api';
import type { CompanyProfile, Competitor, SocialProfile } from '@/types/onboarding';
import type { Project } from '@/types/project';

type LoadState =
  | { status: 'loading' }
  | { status: 'no-projects' }
  | { status: 'preparing'; project: Project }
  | {
      status: 'ready';
      project: Project;
      profile: CompanyProfile;
      socials: SocialProfile[];
      competitors: Competitor[];
    }
  | { status: 'error'; message: string };

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6">{children}</CardContent>
      </Card>
    </div>
  );
}

export default function OnboardingPage() {
  const { user, accessToken, isLoading } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  function reload() {
    setState({ status: 'loading' });
    setReloadToken((t) => t + 1);
  }

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (isLoading || !user || !accessToken || !user.clientId) return;
    const clientId = user.clientId;
    const token = accessToken;
    let cancelled = false;

    listProjects(token, clientId)
      .then((projects) => {
        if (cancelled) return;
        if (projects.length === 0) {
          setState({ status: 'no-projects' });
          return;
        }
        const project = [...projects].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        return Promise.all([
          getCompanyContext(token, clientId, project.id),
          listSocialProfiles(token, clientId, project.id),
          listCompetitors(token, clientId, project.id),
        ]).then(([context, socials, competitors]) => {
          if (cancelled) return;
          if (!context) {
            setState({ status: 'preparing', project });
            return;
          }
          setState({ status: 'ready', project, profile: context.profile, socials, competitors });
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : 'Something went wrong' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isLoading, user, accessToken, reloadToken]);

  if (isLoading || state.status === 'loading') {
    return (
      <Centered>
        <p className="text-sm text-muted-foreground">Loading your details…</p>
      </Centered>
    );
  }

  if (!user) return null;

  if (!user.clientId || user.role === 'ADMIN') {
    return (
      <Centered>
        <CardHeader>
          <CardTitle className="text-xl">Onboarding is for client accounts</CardTitle>
        </CardHeader>
        <p className="text-sm text-muted-foreground">
          This flow reviews a client&apos;s company details. Admins don&apos;t have any to review.
        </p>
        <Button variant="secondary" nativeButton={false} render={<Link href="/dashboard">Back to dashboard</Link>} className="mt-4" />
      </Centered>
    );
  }

  if (state.status === 'no-projects') {
    return (
      <Centered>
        <CardHeader>
          <CardTitle className="text-xl">No projects yet</CardTitle>
        </CardHeader>
        <p className="text-sm text-muted-foreground">
          There&apos;s nothing to review until your admin sets up your first project. Check
          back soon.
        </p>
      </Centered>
    );
  }

  if (state.status === 'preparing') {
    return (
      <Centered>
        <CardHeader>
          <CardTitle className="text-xl">Your audit is still being prepared</CardTitle>
        </CardHeader>
        <p className="text-sm text-muted-foreground">
          We&apos;re still researching {state.project.domain}. This usually takes a while —
          grab a coffee and check back.
        </p>
        <Button variant="secondary" onClick={reload} className="mt-4">
          Check again
        </Button>
      </Centered>
    );
  }

  if (state.status === 'error') {
    return (
      <Centered>
        <CardHeader>
          <CardTitle className="text-xl">Something went wrong</CardTitle>
        </CardHeader>
        <p className="text-sm text-destructive">{state.message}</p>
        <Button variant="secondary" onClick={reload} className="mt-4">
          Try again
        </Button>
      </Centered>
    );
  }

  return (
    <OnboardingWizard
      accessToken={accessToken!}
      clientId={user.clientId}
      project={state.project}
      profile={state.profile}
      socials={state.socials}
      competitors={state.competitors}
      canEdit={user.role === 'CLIENT_POC'}
    />
  );
}
