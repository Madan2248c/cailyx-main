'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { listProjects } from '@/lib/projects-api';
import { listClients } from '@/lib/team-api';
import type { Project } from '@/types/project';

export default function AdminPreviewClientPage() {
  const { user, accessToken, isLoading } = useAuth();
  const router = useRouter();
  const params = useParams<{ clientId: string }>();
  const clientId = params.clientId;

  const [clientName, setClientName] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && (!user || user.role !== 'ADMIN')) {
      router.replace('/dashboard');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    listClients(accessToken)
      .then((clients) => {
        if (!cancelled) setClientName(clients.find((c) => c.id === clientId)?.name ?? clientId);
      })
      .catch(() => {
        if (!cancelled) setClientName(clientId);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId]);

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
        <Button variant="ghost" size="sm" onClick={() => router.push('/admin/clients')}>
          ← Clients
        </Button>
      </div>
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
        <p className="text-sm font-medium">Previewing {clientName ?? '…'} (read-only)</p>
        <p className="text-sm text-muted-foreground">
          You are viewing this client&apos;s projects as an admin. Nothing here can be edited.
        </p>
      </div>
      <h1 className="text-xl font-semibold">Projects</h1>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {projects === null && !error ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (projects ?? []).length === 0 && !error ? (
        <p className="text-sm text-muted-foreground">No projects yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {(projects ?? []).map((project) => (
            <Card key={project.id}>
              <CardHeader>
                <CardTitle className="text-base">{project.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{project.domain}</span>
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={`/admin/preview/${clientId}/projects/${project.id}`}>Preview</Link>}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
