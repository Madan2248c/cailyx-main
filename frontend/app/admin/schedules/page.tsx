'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ProjectScheduleBlock } from '@/components/admin/schedules/project-schedule-block';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { listProjects } from '@/lib/projects-api';
import {
  getSocialActivitySchedule,
  getTechnicalAuditSchedule,
  type SocialActivitySchedule,
  type TechnicalAuditSchedule,
} from '@/lib/schedules-api';
import { listClients } from '@/lib/team-api';
import type { Project } from '@/types/project';
import type { ClientSummary } from '@/types/team';

interface ClientBlock {
  client: ClientSummary;
  projects: Project[];
}

interface ProjectSchedules {
  technical: TechnicalAuditSchedule | null;
  social: SocialActivitySchedule | null;
}

async function loadAll(accessToken: string): Promise<{
  blocks: ClientBlock[];
  schedules: Record<string, ProjectSchedules>;
}> {
  const clients = await listClients(accessToken);
  const blocks: ClientBlock[] = await Promise.all(
    clients.map(async (client) => ({
      client,
      projects: await listProjects(accessToken, client.id).catch(() => []),
    })),
  );
  const schedules: Record<string, ProjectSchedules> = {};
  await Promise.all(
    blocks.flatMap(({ client, projects }) =>
      projects.map(async (project) => {
        const [technical, social] = await Promise.all([
          getTechnicalAuditSchedule(accessToken, client.id, project.id).catch(() => null),
          getSocialActivitySchedule(accessToken, client.id, project.id).catch(() => null),
        ]);
        schedules[project.id] = { technical, social };
      }),
    ),
  );
  return { blocks, schedules };
}

export default function AdminSchedulesPage() {
  const { user, accessToken, isLoading } = useAuth();
  const router = useRouter();
  const [blocks, setBlocks] = useState<ClientBlock[] | null>(null);
  const [schedules, setSchedules] = useState<Record<string, ProjectSchedules>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await loadAll(accessToken);
      setBlocks(data.blocks);
      setSchedules(data.schedules);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schedules');
    }
  }, [accessToken]);

  useEffect(() => {
    if (!isLoading && (!user || user.role !== 'ADMIN')) {
      router.replace('/dashboard');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    loadAll(accessToken)
      .then((data) => {
        if (!cancelled) {
          setBlocks(data.blocks);
          setSchedules(data.schedules);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load schedules');
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  if (isLoading || !user || user.role !== 'ADMIN') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Schedules</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Every cadence control that exists today, per client and project. Reporting and AEO have no
        schedule endpoints yet — those rows are marked as gaps, not schedules.
      </p>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {blocks === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : blocks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No clients yet.</p>
      ) : (
        blocks.map(({ client, projects }) => (
          <section key={client.id} className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">{client.name}</h2>
            {projects.length === 0 ? (
              <Card>
                <CardContent className="pt-6 text-sm text-muted-foreground">
                  No projects yet.
                </CardContent>
              </Card>
            ) : (
              projects.map((project) => (
                <ProjectScheduleBlock
                  key={project.id}
                  accessToken={accessToken ?? ''}
                  clientId={client.id}
                  project={project}
                  technical={schedules[project.id]?.technical ?? null}
                  social={schedules[project.id]?.social ?? null}
                  onChanged={refresh}
                />
              ))
            )}
          </section>
        ))
      )}
    </div>
  );
}
