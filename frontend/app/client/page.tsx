'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { listProjects } from '@/lib/projects-api';
import type { Project } from '@/types/project';

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

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!projects) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading projects…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold">Projects</h1>
        <p className="text-sm text-muted-foreground">Select a project to open its workspace.</p>
      </div>
      {googleResult === 'connected' ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          Google account connected — open a project to see its Organic dashboard.
        </p>
      ) : null}
      {googleResult === 'error' ? (
        <p className="rounded-lg border border-border px-3 py-2 text-sm text-destructive">
          Google connection failed — please try connecting again.
        </p>
      ) : null}
      {projects.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              No projects yet — your admin will set up your first one soon.
            </p>
          </CardContent>
        </Card>
      ) : (
        projects.map((project) => (
          <Card key={project.id}>
            <CardHeader>
              <CardTitle className="text-lg">{project.name}</CardTitle>
              <CardDescription>{project.domain}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="secondary" nativeButton={false} render={<Link href={`/client/projects/${project.id}`}>Open</Link>} />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
