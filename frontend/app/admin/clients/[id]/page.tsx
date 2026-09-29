'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Eye } from 'lucide-react';
import { ClientSchedulesSection } from '@/components/admin/client-schedules/client-schedules-section';
import { ConfirmDialog, Day1Chip, Monogram, Notice } from '@/components/admin/admin-ui';
import { CreateProjectDialog } from '@/components/admin/create-project-dialog';
import { Day1ProgressPanel } from '@/components/admin/day1-progress-panel';
import { useLoad } from '@/components/admin/use-load';
import { SyncFixPlanButton, type SyncResult } from '@/components/admin/sync-fix-plan-button';
import { Button } from '@/components/portal/button';
import { Section } from '@/components/portal/blocks';
import { MetaDot, PageHeader, PortalPage, StatusChip } from '@/components/portal/layout';
import { EmptyState, PortalLoading } from '@/components/portal/states';
import { formatDate, plural } from '@/components/portal/tone';
import { useAuth } from '@/contexts/auth-context';
import { retryDay1Pipeline } from '@/lib/admin-api';
import { archiveProject, listProjects } from '@/lib/projects-api';
import { getDay1Status, type Day1Status } from '@/lib/settings-api';
import { listClients } from '@/lib/team-api';
import type { Project } from '@/types/project';
import type { ClientSummary } from '@/types/team';

type Day1Map = Record<string, Day1Status | null>;

interface ProjectsData {
  projects: Project[];
  /** Each project's Day-1 run, or `null` when it has none. */
  day1: Day1Map;
}

async function loadProjects(accessToken: string, clientId: string): Promise<ProjectsData> {
  const projects = await listProjects(accessToken, clientId);
  const entries = await Promise.all(
    projects.map(async (p) => [p.id, await getDay1Status(accessToken, clientId, p.id).catch(() => null)] as const),
  );
  return { projects, day1: Object.fromEntries(entries) };
}

/** What the Day-1 control does, by pipeline state. RUNNING and COMPLETE runs can't be retried (double spend). */
function day1Action(status: Day1Status['status'] | null): { label: string; verb: string } | null {
  if (status === null) return { label: 'Start Day-1', verb: 'Start' };
  if (status === 'FAILED') return { label: 'Retry Day-1', verb: 'Retry' };
  if (status === 'QUEUED') return { label: 'Re-queue Day-1', verb: 'Re-queue' };
  return null;
}

export default function ClientProjectsPage() {
  const { accessToken } = useAuth();
  const params = useParams<{ id: string }>();
  const clientId = params.id;

  const loadClient = useCallback(async () => {
    const all = await listClients(accessToken ?? '');
    return all.find((c) => c.id === clientId) ?? null;
  }, [accessToken, clientId]);
  const clientLoad = useLoad<ClientSummary | null>(accessToken ? loadClient : null, 'Failed to load the client');

  const loadAll = useCallback(() => loadProjects(accessToken ?? '', clientId), [accessToken, clientId]);
  const projectsLoad = useLoad(accessToken ? loadAll : null, 'Failed to load projects');
  const reload = projectsLoad.reload;

  const [result, setResult] = useState<SyncResult | null>(null);
  const [toArchive, setToArchive] = useState<Project | null>(null);
  const [toRun, setToRun] = useState<Project | null>(null);

  // `undefined` while the client is still loading, `null` when it doesn't exist.
  const client = clientLoad.loading && clientLoad.data === null && !clientLoad.error ? undefined : clientLoad.data;
  const projects = projectsLoad.data?.projects ?? null;
  /** `null` until the first status lookup lands, so no control flashes in with a guessed state. */
  const day1 = projectsLoad.data?.day1 ?? null;
  const error = projectsLoad.error ?? clientLoad.error;

  // While any audit is live, re-read the statuses so the progress moves on its own.
  const anyActive = Object.values(projectsLoad.data?.day1 ?? {}).some((d) => d?.status === 'RUNNING' || d?.status === 'QUEUED');
  useEffect(() => {
    if (!anyActive) return;
    const id = setInterval(() => void reload(), 6000);
    return () => clearInterval(id);
  }, [anyActive, reload]);

  if (client === undefined || (projects === null && projectsLoad.loading)) return <PortalLoading label="Loading the client" />;

  if (client === null) {
    return (
      <PortalPage>
        <div>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/admin/clients"><ArrowLeft aria-hidden className="size-4" /> Clients</Link>} />
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Section eyebrow="Client">
          <EmptyState title="Client not found" body="This client doesn't exist, or the link is out of date. Head back to the client list to pick one." />
        </Section>
      </PortalPage>
    );
  }

  const list = projects ?? [];
  const suspended = client.status === 'SUSPENDED';

  return (
    <PortalPage>
      <div>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/admin/clients"><ArrowLeft aria-hidden className="size-4" /> Clients</Link>} />
      </div>

      <PageHeader
        eyebrow="Client"
        title={client.name}
        meta={
          <>
            <StatusChip tone={suspended ? 'bad' : 'good'}>{suspended ? 'Suspended' : 'Active'}</StatusChip>
            <MetaDot />
            <span className="g-num">
              Seats {client.seatsUsed} / {client.seatLimit}
            </span>
            <MetaDot />
            <span>{client.poc ? client.poc.email : 'No point of contact yet'}</span>
          </>
        }
        summary={
          list.length === 0
            ? 'No projects yet. Create one to start its Day-1 audit.'
            : `${plural(list.length, 'project')}. Preview as client opens their portal with your admin controls on top.`
        }
        actions={
          <>
            {accessToken ? <CreateProjectDialog accessToken={accessToken} clientId={clientId} onCreated={reload} /> : null}
          </>
        }
      />

      {error ? <Notice tone="error">{error}</Notice> : null}
      {result ? (
        <Notice tone={result.tone} onDismiss={() => setResult(null)}>
          {result.text}
        </Notice>
      ) : null}

      <Section eyebrow="Projects" title={list.length > 0 ? plural(list.length, 'project') : undefined} flush>
        {list.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState
              compact
              title="No projects yet"
              body="Add the first project. Creating it starts the automatic Day-1 audit."
            />
          </div>
        ) : (
          <ul className="flex flex-col pb-1">
            {list.map((project) => {
              const run = day1 ? (day1[project.id] ?? null) : null;
              const action = day1 ? day1Action(run?.status ?? null) : null;
              return (
                <li key={project.id} className="border-t border-border first:border-t-0">
                  <div className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:gap-5">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Monogram name={project.name} />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold">{project.name}</span>
                          {day1 ? <Day1Chip status={run?.status ?? null} /> : null}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          <a
                            href={`https://${project.domain}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline-offset-4 hover:text-foreground hover:underline"
                          >
                            {project.domain}
                          </a>
                          {' · '}created {formatDate(project.createdAt)}
                        </span>
                        {run?.status === 'FAILED' && run.error ? (
                          <span className="line-clamp-2 text-xs text-danger" title={run.error}>
                            {run.error}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
                      <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/admin/preview/${clientId}/projects/${project.id}`}><Eye aria-hidden className="size-3.5" /> Preview as client</Link>} />
                      {action ? (
                        <Button size="sm" variant="outline" onClick={() => setToRun(project)}>
                          {action.label}
                        </Button>
                      ) : null}
                      {accessToken ? (
                        <SyncFixPlanButton
                          accessToken={accessToken}
                          clientId={clientId}
                          projectId={project.id}
                          projectName={project.name}
                          onResult={setResult}
                        />
                      ) : null}
                      <Button size="sm" variant="outline" onClick={() => setToArchive(project)}>
                        Archive
                      </Button>
                    </div>
                  </div>
                  {run ? <Day1Block day1={run} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {accessToken ? <ClientSchedulesSection accessToken={accessToken} clientId={clientId} projects={projects} /> : null}

      <ConfirmDialog
        open={toArchive !== null}
        onOpenChange={(open) => {
          if (!open) setToArchive(null);
        }}
        destructive
        title={`Archive ${toArchive?.name ?? 'this project'}?`}
        description="It disappears from the client's portal and stops its scheduled runs. There is no way to bring it back from here."
        confirmLabel="Archive project"
        pendingLabel="Archiving…"
        onConfirm={async () => {
          if (!accessToken || !toArchive) return;
          await archiveProject(accessToken, clientId, toArchive.id);
          await reload();
          setResult({ tone: 'ok', text: `${toArchive.name} was archived.` });
        }}
      />

      <ConfirmDialog
        open={toRun !== null}
        onOpenChange={(open) => {
          if (!open) setToRun(null);
        }}
        title={`${day1Action((toRun && day1?.[toRun.id]?.status) || null)?.verb ?? 'Run'} the Day-1 audit for ${toRun?.name ?? 'this project'}?`}
        description="This runs the audit stages that haven't finished yet. Crawls and AI answer engines cost money, and your click is the authorization. Stages that already completed are not run again."
        confirmLabel="Run Day-1 audit"
        pendingLabel="Queuing…"
        onConfirm={async () => {
          if (!accessToken || !toRun) return;
          await retryDay1Pipeline(accessToken, clientId, toRun.id);
          await reload();
          setResult({ tone: 'ok', text: `${toRun.name}: Day-1 audit queued. Its status updates as stages finish.` });
        }}
      />
    </PortalPage>
  );
}

/** The Day-1 audit under a project row. Live and failed audits are open; a finished one folds away. */
function Day1Block({ day1 }: { day1: Day1Status }) {
  if (day1.status === 'COMPLETE') {
    return (
      <details className="group px-5 pb-4">
        <summary className="w-fit cursor-pointer list-none rounded text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
          Day-1 audit finished. <span className="underline underline-offset-4">Show the steps</span>
        </summary>
        <Day1ProgressPanel day1={day1} />
      </details>
    );
  }
  return (
    <div className="px-5 pb-4">
      <Day1ProgressPanel day1={day1} />
    </div>
  );
}
