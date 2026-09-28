'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { getDataforseoSchedule } from '@/lib/admin-api';
import { listProjects } from '@/lib/projects-api';
import { getDay1Status, type Day1Status } from '@/lib/settings-api';
import {
  getSocialActivitySchedule,
  getTechnicalAuditSchedule,
} from '@/lib/schedules-api';
import { listClients } from '@/lib/team-api';
import type { Project } from '@/types/project';
import type { ClientSummary } from '@/types/team';

interface OverviewData {
  clients: ClientSummary[];
  totalProjects: number;
  day1: { running: number; failed: number; available: boolean };
  scheduled: { technical: number; social: number; dataforseo: number };
  manual: { technical: number; social: number; dataforseo: number };
}

async function loadOverview(accessToken: string): Promise<OverviewData> {
  const clients = await listClients(accessToken);
  const projectsByClient: Project[][] = await Promise.all(
    clients.map((client) => listProjects(accessToken, client.id).catch(() => [])),
  );
  const all: Array<{ clientId: string; project: Project }> = clients.flatMap((client, i) =>
    (projectsByClient[i] ?? []).map((project) => ({ clientId: client.id, project })),
  );

  const day1Results: Array<Day1Status | null> = await Promise.all(
    all.map(({ clientId, project }) =>
      getDay1Status(accessToken, clientId, project.id).catch(() => null),
    ),
  );
  const known = day1Results.filter((d) => d !== null);

  const schedResults = await Promise.all(
    all.map(({ clientId, project }) =>
      Promise.all([
        getTechnicalAuditSchedule(accessToken, clientId, project.id).catch(() => null),
        getSocialActivitySchedule(accessToken, clientId, project.id).catch(() => null),
        getDataforseoSchedule(accessToken, clientId, project.id).catch(() => null),
      ]),
    ),
  );

  const scheduled = { technical: 0, social: 0, dataforseo: 0 };
  const manual = { technical: 0, social: 0, dataforseo: 0 };
  for (const [technical, social, dataforseo] of schedResults) {
    if (technical && technical.active) scheduled.technical += 1;
    else manual.technical += 1;
    if (social && social.active) scheduled.social += 1;
    else manual.social += 1;
    if (dataforseo && dataforseo.active) scheduled.dataforseo += 1;
    else manual.dataforseo += 1;
  }

  return {
    clients,
    totalProjects: all.length,
    day1: {
      running: known.filter((d) => d.status === 'RUNNING' || d.status === 'QUEUED').length,
      failed: known.filter((d) => d.status === 'FAILED').length,
      available: known.length > 0,
    },
    scheduled,
    manual,
  };
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export default function AdminOverviewPage() {
  const { user, accessToken, isLoading } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && (!user || user.role !== 'ADMIN')) {
      router.replace('/dashboard');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    loadOverview(accessToken)
      .then((overview) => {
        if (!cancelled) setData(overview);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load overview');
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

  const recent = data
    ? [...data.clients]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5)
    : null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Clients, projects, pipeline health, and scheduling coverage — live, never sample data.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {data === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Total clients" value={String(data.clients.length)} />
            <Kpi label="Active projects" value={String(data.totalProjects)} />
            {data.day1.available ? (
              <>
                <Kpi
                  label="Pipelines running"
                  value={String(data.day1.running)}
                  hint="Day-1 status QUEUED or RUNNING"
                />
                <Kpi
                  label="Pipelines failed"
                  value={String(data.day1.failed)}
                  hint="Day-1 status FAILED"
                />
              </>
            ) : null}
          </section>
          {!data.day1.available ? (
            <p className="text-xs text-muted-foreground">
              No Day-1 pipeline statuses reported yet — pipeline tiles appear once projects report
              one.
            </p>
          ) : null}

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Recent clients</h2>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href="/admin/clients">All clients</Link>}
              />
            </div>
            {recent && recent.length > 0 ? (
              <div className="flex flex-col gap-3">
                {recent.map((client) => (
                  <Card key={client.id}>
                    <CardContent className="flex items-center justify-between gap-2 pt-6 text-sm">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{client.name}</span>
                        <Badge variant={client.status === 'ACTIVE' ? 'default' : 'destructive'}>
                          {client.status}
                        </Badge>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        nativeButton={false}
                        render={<Link href={`/admin/clients/${client.id}`}>Projects</Link>}
                      />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No clients yet.</p>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">System health</h2>
            <Card>
              <CardContent className="flex flex-col gap-2 pt-6 text-sm">
                <p>
                  Technical audits — {data.scheduled.technical} scheduled ·{' '}
                  {data.manual.technical} manual / never set
                </p>
                <p>
                  Social activity — {data.scheduled.social} scheduled · {data.manual.social}{' '}
                  manual / never set
                </p>
                <p>
                  DataForSEO — {data.scheduled.dataforseo} scheduled · {data.manual.dataforseo}{' '}
                  manual / never set
                </p>
                <p className="text-muted-foreground">
                  Reporting and AEO have no schedule endpoints on the backend — both run on demand
                  (see Schedules for the gap notes).
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  nativeButton={false}
                  render={<Link href="/admin/schedules">Open Schedules</Link>}
                />
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
