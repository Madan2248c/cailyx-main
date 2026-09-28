'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CreateProjectDialog } from '@/components/admin/create-project-dialog';
import { ClientSchedulesSection } from '@/components/admin/client-schedules/client-schedules-section';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { archiveProject, listProjects } from '@/lib/projects-api';
import type { Project } from '@/types/project';

export default function ClientProjectsPage() {
  const { user, accessToken, isLoading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const clientId = params.id;

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    try {
      setProjects(await listProjects(accessToken, clientId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    }
  }, [accessToken, clientId]);

  useEffect(() => {
    if (!isLoading && (!user || user.role !== 'ADMIN')) {
      router.replace('/dashboard');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!accessToken) return;
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
  }, [accessToken, clientId]);

  async function handleArchive(project: Project) {
    if (!accessToken) return;
    setPendingId(project.id);
    setError(null);
    try {
      await archiveProject(accessToken, clientId, project.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setPendingId(null);
    }
  }

  if (isLoading || !user || user.role !== 'ADMIN') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-10">
      <div>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/admin/clients">← Clients</Link>} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Projects</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={`/admin/preview/${clientId}`}>Preview as client</Link>}
          />
          {accessToken ? (
            <CreateProjectDialog accessToken={accessToken} clientId={clientId} onCreated={refresh} />
          ) : null}
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {projects === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {projects.map((project) => (
            <Card key={project.id}>
              <CardHeader>
                <CardTitle className="text-base">{project.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{project.domain}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pendingId === project.id}
                  onClick={() => handleArchive(project)}
                >
                  Archive
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {accessToken ? (
        <ClientSchedulesSection accessToken={accessToken} clientId={clientId} projects={projects} />
      ) : null}
    </div>
  );
}
