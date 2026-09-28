'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowUpRight, CircleCheck, TriangleAlert } from 'lucide-react';
import { PageHeader, PortalPage } from '@/components/portal/layout';
import { EmptyState, ErrorState, Skeleton } from '@/components/portal/states';
import { useAuth } from '@/contexts/auth-context';
import { listProjects } from '@/lib/projects-api';
import type { Project } from '@/types/project';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export default function ClientProjectsPage() {
  const { user, accessToken } = useAuth();
  const searchParams = useSearchParams();
  const googleResult = searchParams.get('google');
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken || !user?.clientId) return;
    const clientId = user.clientId;
    let cancelled = false;

    listProjects(accessToken, clientId)
      .then((data) => {
        if (!cancelled) setProjects(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load projects');
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, user]);

  if (error) return <ErrorState message={error} />;

  return (
    <PortalPage className="max-w-4xl">
      <PageHeader
        eyebrow="Welcome back"
        title="Your projects"
        summary="Choose a project to see how AI answer engines see your company, and what to do next."
      />

      {googleResult === 'connected' ? (
        <p className="g-rise flex items-center gap-2 rounded-xl px-4 py-3 text-sm" style={{ background: 'var(--success-soft)', '--i': 1 } as React.CSSProperties}>
          <CircleCheck className="size-4 text-success" /> Google account connected. Open a project to see its Organic dashboard.
        </p>
      ) : null}
      {googleResult === 'error' ? (
        <p className="g-rise flex items-center gap-2 rounded-xl px-4 py-3 text-sm text-danger" style={{ background: 'var(--danger-soft)', '--i': 1 } as React.CSSProperties}>
          <TriangleAlert className="size-4" /> Google connection failed. Please try connecting again.
        </p>
      ) : null}

      {!projects ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      ) : projects.length === 0 ? (
        <div className="g-tile g-rise p-6" style={{ '--i': 1 } as React.CSSProperties}>
          <EmptyState title="Your first project is on its way" body="Your Rothenhall lead sets up each project. You'll see it here as soon as it's created." />
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {projects.map((project, i) => (
            <li key={project.id}>
              <Link
                href={`/client/projects/${project.id}`}
                className="g-tile g-rise h-full gap-5 p-5"
                style={{ '--i': i + 1 } as React.CSSProperties}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-foreground text-sm font-semibold text-background">
                    {initials(project.name)}
                  </span>
                  <ArrowUpRight className="g-row-arrow size-4 text-muted-foreground" />
                </div>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="truncate text-lg font-semibold">{project.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{project.domain}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PortalPage>
  );
}
