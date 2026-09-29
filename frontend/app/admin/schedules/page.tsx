'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Notice } from '@/components/admin/admin-ui';
import { useLoad } from '@/components/admin/use-load';
import { ProjectScheduleBlock } from '@/components/admin/schedules/project-schedule-block';
import { useProjectSchedules } from '@/components/admin/schedules/use-project-schedules';
import { InlineEmpty, Section } from '@/components/portal/blocks';
import { PageHeader, PortalPage, StatusChip } from '@/components/portal/layout';
import { EmptyState, PortalLoading } from '@/components/portal/states';
import { plural } from '@/components/portal/tone';
import { useAuth } from '@/contexts/auth-context';
import { listProjects } from '@/lib/projects-api';
import { listClients } from '@/lib/team-api';
import type { Project } from '@/types/project';
import type { ClientSummary } from '@/types/team';

interface ClientBlock {
  client: ClientSummary;
  /** `null` when this client's projects could not be loaded. */
  projects: Project[] | null;
}

async function loadBlocks(accessToken: string): Promise<ClientBlock[]> {
  const clients = await listClients(accessToken);
  return Promise.all(
    clients.map(async (client) => ({
      client,
      projects: await listProjects(accessToken, client.id).catch(() => null),
    })),
  );
}

function ClientScheduleGroup({ accessToken, block }: { accessToken: string; block: ClientBlock }) {
  const { client, projects } = block;
  const { schedules, error, refresh } = useProjectSchedules(accessToken, client.id, projects);

  return (
    <section aria-label={client.name} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold leading-snug">{client.name}</h2>
        {client.status === 'SUSPENDED' ? <StatusChip tone="bad">Suspended</StatusChip> : null}
        <Link
          href={`/admin/clients/${client.id}`}
          className="ml-auto inline-flex items-center gap-1 rounded text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Client page <ArrowUpRight aria-hidden className="size-4" />
        </Link>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {projects === null ? (
        <Notice tone="error">Couldn&apos;t load this client&apos;s projects. Refresh to try again.</Notice>
      ) : projects.length === 0 ? (
        <InlineEmpty>No projects yet.</InlineEmpty>
      ) : (
        projects.map((project, i) => (
          <ProjectScheduleBlock
            key={project.id}
            index={i}
            accessToken={accessToken}
            clientId={client.id}
            project={project}
            technical={schedules[project.id]?.technical ?? null}
            social={schedules[project.id]?.social ?? null}
            onChanged={() => void refresh()}
          />
        ))
      )}
    </section>
  );
}

export default function AdminSchedulesPage() {
  const { accessToken } = useAuth();
  const load = useCallback(() => loadBlocks(accessToken ?? ''), [accessToken]);
  const { data: blocks, error, loading } = useLoad(accessToken ? load : null, 'Failed to load schedules');

  if (blocks === null && loading) return <PortalLoading label="Loading schedules" />;

  const projectCount = (blocks ?? []).reduce((n, b) => n + (b.projects?.length ?? 0), 0);

  return (
    <PortalPage>
      <PageHeader
        eyebrow="Admin console"
        title="Schedules"
        summary={
          projectCount === 0
            ? 'Cadences appear here once a client has a project.'
            : `${plural(projectCount, 'project')} across ${plural((blocks ?? []).length, 'client')}. Changes save the moment you make them.`
        }
      />

      {error ? <Notice tone="error">{error}</Notice> : null}

      <p className="max-w-3xl text-sm text-muted-foreground">
        Technical audits, social activity and DataForSEO can run on a cadence. Social and DataForSEO cost money, so their
        scheduled runs wait for your spend opt-in. Reports and AEO audits run on demand.
      </p>

      {blocks !== null && blocks.length === 0 ? (
        <Section eyebrow="Schedules">
          <EmptyState title="No clients yet" body="Create a client and add a project, then set its cadence here." />
        </Section>
      ) : null}

      {(blocks ?? []).map((block) => (
        <ClientScheduleGroup key={block.client.id} accessToken={accessToken ?? ''} block={block} />
      ))}
    </PortalPage>
  );
}
