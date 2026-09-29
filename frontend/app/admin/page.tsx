'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { Day1Chip, Monogram, Notice } from '@/components/admin/admin-ui';
import { useLoad } from '@/components/admin/use-load';
import { Button } from '@/components/portal/button';
import { Meter } from '@/components/portal/charts';
import { NextSteps, Section, Stat, type NextStep } from '@/components/portal/blocks';
import { PageHeader, PortalPage, StatusChip, Tile } from '@/components/portal/layout';
import { Num } from '@/components/portal/motion';
import { PortalLoading } from '@/components/portal/states';
import { plural, relativeDate } from '@/components/portal/tone';
import { useAuth } from '@/contexts/auth-context';
import { getDataforseoSchedule } from '@/lib/admin-api';
import { clearApiCache } from '@/lib/api-cache';
import { listProjects } from '@/lib/projects-api';
import { getSocialActivitySchedule, getTechnicalAuditSchedule } from '@/lib/schedules-api';
import { getDay1Status, type Day1Status } from '@/lib/settings-api';
import { listClients } from '@/lib/team-api';
import type { Project } from '@/types/project';
import type { ClientSummary } from '@/types/team';

interface FleetProject {
  client: ClientSummary;
  project: Project;
  day1: Day1Status | null;
}

interface Coverage {
  scheduled: number;
  manual: number;
  /** Lookups that errored, so they are neither scheduled nor manual. */
  unknown: number;
}

interface OverviewData {
  clients: ClientSummary[];
  fleet: FleetProject[];
  technical: Coverage;
  social: Coverage;
  dataforseo: Coverage;
}

/** An active schedule counts as scheduled; a missing or paused one is manual; an error is unknown. */
function tally(target: Coverage, result: { active: boolean } | null | 'error') {
  if (result === 'error') target.unknown += 1;
  else if (result && result.active) target.scheduled += 1;
  else target.manual += 1;
}

async function loadOverview(accessToken: string): Promise<OverviewData> {
  const clients = await listClients(accessToken);
  const projectsByClient = await Promise.all(
    clients.map((client) => listProjects(accessToken, client.id).catch((): Project[] => [])),
  );
  const flat = clients.flatMap((client, i) => (projectsByClient[i] ?? []).map((project) => ({ client, project })));

  const rows = await Promise.all(
    flat.map(async ({ client, project }) => {
      const [day1, technical, social, dataforseo] = await Promise.all([
        // A project with no pipeline run answers 404: that is "no Day-1 run", not an outage.
        getDay1Status(accessToken, client.id, project.id).catch(() => null),
        getTechnicalAuditSchedule(accessToken, client.id, project.id).catch(() => 'error' as const),
        getSocialActivitySchedule(accessToken, client.id, project.id).catch(() => 'error' as const),
        getDataforseoSchedule(accessToken, client.id, project.id).catch(() => 'error' as const),
      ]);
      return { client, project, day1, technical, social, dataforseo };
    }),
  );

  const technical: Coverage = { scheduled: 0, manual: 0, unknown: 0 };
  const social: Coverage = { scheduled: 0, manual: 0, unknown: 0 };
  const dataforseo: Coverage = { scheduled: 0, manual: 0, unknown: 0 };
  for (const row of rows) {
    tally(technical, row.technical);
    tally(social, row.social);
    tally(dataforseo, row.dataforseo);
  }

  return {
    clients,
    fleet: rows.map(({ client, project, day1 }) => ({ client, project, day1 })),
    technical,
    social,
    dataforseo,
  };
}

function CoverageRow({ label, coverage, total }: { label: string; coverage: Coverage; total: number }) {
  const known = total - coverage.unknown;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="g-num text-muted-foreground">
          {coverage.scheduled} of {known} scheduled
        </span>
      </div>
      <Meter
        value={coverage.scheduled}
        max={Math.max(known, 1)}
        tone={known === 0 ? 'neutral' : coverage.scheduled === known ? 'good' : coverage.scheduled === 0 ? 'bad' : 'watch'}
        label={`${label}: ${coverage.scheduled} of ${known} projects scheduled`}
      />
      {coverage.unknown > 0 ? (
        <p className="text-xs text-warning">Could not check {plural(coverage.unknown, 'project')}. Refresh to retry.</p>
      ) : null}
    </li>
  );
}

export default function AdminOverviewPage() {
  const { accessToken } = useAuth();
  const load = useCallback(() => loadOverview(accessToken ?? ''), [accessToken]);
  const { data, error, loading, reload } = useLoad(accessToken ? load : null, 'Failed to load the overview');
  const refreshing = loading && data !== null;

  // A manual refresh bypasses the read cache so it really re-fetches.
  function refresh() {
    clearApiCache();
    reload();
  }

  if (data === null && loading) return <PortalLoading label="Loading the overview" />;

  const clients = data?.clients ?? [];
  const fleet = data?.fleet ?? [];
  const activeClients = clients.filter((c) => c.status === 'ACTIVE');
  const suspended = clients.filter((c) => c.status === 'SUSPENDED');
  const failed = fleet.filter((f) => f.day1?.status === 'FAILED');
  const running = fleet.filter((f) => f.day1?.status === 'RUNNING' || f.day1?.status === 'QUEUED');
  const noRun = fleet.filter((f) => f.day1 === null);
  const reported = fleet.length - noRun.length;
  const noPoc = activeClients.filter((c) => c.poc === null);
  const pendingPoc = activeClients.filter((c) => c.poc !== null && c.poc.status === 'INVITED');
  const recent = [...clients].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);

  const steps: NextStep[] = [];
  if (failed.length > 0) {
    steps.push({
      tone: 'bad',
      lead: `${plural(failed.length, 'Day-1 pipeline')} failed.`,
      text: (
        <>
          Open {failed.slice(0, 3).map((f, i) => (
            <span key={f.project.id}>
              {i > 0 ? ', ' : ''}
              <Link className="font-medium text-foreground underline underline-offset-4" href={`/admin/clients/${f.client.id}`}>
                {f.project.name}
              </Link>
            </span>
          ))}
          {failed.length > 3 ? ` and ${failed.length - 3} more` : ''} to retry the run.
        </>
      ),
    });
  }
  if (noPoc.length > 0) {
    steps.push({
      tone: 'watch',
      lead: `${plural(noPoc.length, 'active client')} without a point of contact.`,
      text: `${noPoc.slice(0, 3).map((c) => c.name).join(', ')}${noPoc.length > 3 ? '…' : ''} can't sign in until an invite goes out.`,
    });
  }
  if (pendingPoc.length > 0) {
    steps.push({
      tone: 'watch',
      lead: `${plural(pendingPoc.length, 'invite')} not yet accepted.`,
      text: `${pendingPoc.slice(0, 3).map((c) => c.name).join(', ')}${pendingPoc.length > 3 ? '…' : ''} still need to set a password.`,
    });
  }
  if (suspended.length > 0) {
    steps.push({
      tone: 'neutral',
      lead: `${plural(suspended.length, 'client')} suspended.`,
      text: 'Their users are locked out until you activate them.',
    });
  }
  if (data && data.technical.scheduled + data.social.scheduled === 0 && fleet.length > 0) {
    steps.push({
      tone: 'watch',
      lead: 'No audits are scheduled.',
      text: 'Every project relies on manual runs. Set a cadence under Schedules.',
    });
  }

  const summary =
    clients.length === 0
      ? 'No clients yet. Create the first one to get started.'
      : failed.length > 0
        ? `${plural(clients.length, 'client')}, ${plural(fleet.length, 'project')}. ${plural(failed.length, 'pipeline')} failed and need a retry.`
        : `${plural(clients.length, 'client')}, ${plural(fleet.length, 'project')}. Every reported pipeline is healthy.`;

  return (
    <PortalPage>
      <PageHeader
        eyebrow="Admin console"
        title="Overview"
        summary={summary}
        actions={
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing} aria-busy={refreshing}>
            <RefreshCw aria-hidden className={refreshing ? 'size-4 animate-spin' : 'size-4'} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      />

      {error ? <Notice tone="error">{error}</Notice> : null}

      {data ? (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Tile ink shine index={0} className="md:col-span-2 md:row-span-2">
              <p className="g-eyebrow">Clients</p>
              <p className="g-num mt-2 text-5xl leading-none font-semibold">
                <Num value={clients.length} />
              </p>
              <p className="mt-3 text-sm text-white/70">
                {activeClients.length} active
                {suspended.length > 0 ? ` · ${suspended.length} suspended` : ''}
              </p>
              {clients.length > 0 ? (
                <div className="mt-4 max-w-xs">
                  <Meter
                    onInk
                    height={5}
                    value={activeClients.length}
                    max={clients.length}
                    label={`${activeClients.length} of ${clients.length} clients active`}
                  />
                </div>
              ) : null}
              <div className="mt-auto flex items-center gap-2 pt-6">
                <Link
                  href="/admin/clients"
                  className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/50"
                >
                  Manage clients <ArrowUpRight className="size-4" aria-hidden />
                </Link>
              </div>
            </Tile>
            <Stat index={1} label="Projects" value={fleet.length} caption={plural(clients.filter((c) => fleet.some((f) => f.client.id === c.id)).length, 'client') + ' with projects'} />
            <Stat
              index={2}
              label="Pipelines running"
              value={reported > 0 ? running.length : null}
              tone={running.length > 0 ? 'watch' : 'neutral'}
              caption={reported > 0 ? 'Day-1 queued or running' : 'Appear once a project starts one'}
            />
            <Stat
              index={3}
              label="Pipelines failed"
              value={reported > 0 ? failed.length : null}
              tone={failed.length > 0 ? 'bad' : reported > 0 ? 'good' : 'neutral'}
              caption={reported > 0 ? (failed.length > 0 ? 'Need a retry' : 'Nothing to retry') : 'Appear once a project starts one'}
            />
            <Stat
              index={4}
              label="Seats in use"
              value={clients.reduce((n, c) => n + c.seatsUsed, 0)}
              unit={`of ${clients.reduce((n, c) => n + c.seatLimit, 0)}`}
              caption="Across all clients"
            />
          </div>

          <NextSteps index={5} title="Needs attention" items={steps} allClear="Nothing needs your attention. Pipelines are healthy and every client has a way in." />

          <div className="grid gap-4 lg:grid-cols-5">
            <Section
              index={6}
              eyebrow="Recently added"
              title="Latest clients"
              flush
              className="lg:col-span-3"
              right={
                <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/admin/clients">All clients</Link>} />
              }
            >
              {recent.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-muted-foreground">No clients yet.</p>
              ) : (
                <ul className="flex flex-col pb-2">
                  {recent.map((client) => {
                    const projects = fleet.filter((f) => f.client.id === client.id);
                    return (
                      <li key={client.id} className="border-t border-border first:border-t-0">
                        <Link
                          href={`/admin/clients/${client.id}`}
                          className="g-row-link flex items-center gap-3 px-5 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                        >
                          <Monogram name={client.name} />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm font-medium">{client.name}</span>
                            <span className="truncate text-xs text-muted-foreground">
                              {plural(projects.length, 'project')} · added {relativeDate(client.createdAt)}
                            </span>
                          </span>
                          <StatusChip tone={client.status === 'ACTIVE' ? 'good' : 'bad'}>
                            {client.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                          </StatusChip>
                          <ArrowUpRight aria-hidden className="g-row-arrow size-4 shrink-0 opacity-50" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>

            <Section
              index={7}
              eyebrow="Scheduling coverage"
              title="What runs on its own"
              className="lg:col-span-2"
              description="Projects with an active cadence, out of all projects."
            >
              {fleet.length === 0 ? (
                <p className="text-sm text-muted-foreground">Coverage appears once a project exists.</p>
              ) : (
                <ul className="flex flex-col gap-4">
                  <CoverageRow label="Technical audits" coverage={data.technical} total={fleet.length} />
                  <CoverageRow label="Social activity" coverage={data.social} total={fleet.length} />
                  <CoverageRow label="DataForSEO" coverage={data.dataforseo} total={fleet.length} />
                </ul>
              )}
              <p className="mt-4 text-xs text-muted-foreground">Reports and AEO audits run on demand. They have no schedule.</p>
              <Button size="sm" variant="outline" className="mt-3 self-start" nativeButton={false} render={<Link href="/admin/schedules">Open Schedules</Link>} />
            </Section>
          </div>

          {failed.length > 0 || running.length > 0 ? (
            <Section index={8} eyebrow="Pipelines" title="Day-1 audits in flight" flush>
              <ul className="flex flex-col pb-2">
                {[...failed, ...running].map((f) => (
                  <li key={f.project.id} className="border-t border-border first:border-t-0">
                    <Link
                      href={`/admin/clients/${f.client.id}`}
                      className="g-row-link flex items-center gap-3 px-5 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">{f.project.name}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {f.client.name} · {f.project.domain}
                        </span>
                      </span>
                      <Day1Chip status={f.day1?.status} />
                      <ArrowUpRight aria-hidden className="g-row-arrow size-4 shrink-0 opacity-50" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </>
      ) : null}
    </PortalPage>
  );
}
