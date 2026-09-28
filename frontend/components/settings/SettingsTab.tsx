'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getGoogleStatus } from '@/lib/google-api';
import { getDay1Status, type Day1Status } from '@/lib/settings-api';
import { listMembers } from '@/lib/team-api';
import type { GoogleStatus } from '@/types/google';
import type { Project } from '@/types/project';
import type { TeamMembers } from '@/types/team';
import { PortalLoading } from '@/components/portal/states';
import { StaggerIn } from '@/components/portal/reveal';

/** Day-1 stages in execution order (mirrors the backend pipeline). */
const DAY1_STAGE_ORDER = [
  'discovery',
  'technical-audit',
  'social-activity',
  'query-set',
  'aeo-audit',
  'competitors',
  'gap-analysis',
  'remediation',
  'reporting',
  'notify',
];

function stageLabel(stage: string): string {
  if (stage === 'remediation') return 'Fix Plan';
  return stage.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function stageDot(status: string): string {
  if (status === 'completed') return 'bg-success';
  if (status === 'failed') return 'bg-danger';
  if (status === 'skipped') return 'bg-muted-foreground/40';
  if (status === 'running') return 'bg-warning';
  return 'bg-muted-foreground/20';
}

function connectionDot(connected: boolean): string {
  return connected ? 'bg-success' : 'bg-muted-foreground/40';
}

function formatDate(raw: string | null): string {
  if (!raw) return '—';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

/**
 * Read-only Settings tab. Project basics come from the projects list,
 * seats from the team members endpoint (POC-only — hidden for members),
 * Google connection status from the google status endpoint, and the Day-1
 * pipeline card renders only when the backend lets the caller read it
 * (admin-only, so client roles omit it silently).
 */
export function SettingsTab({
  accessToken,
  clientId,
  project,
}: {
  accessToken: string;
  clientId: string;
  project: Project;
}) {
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [team, setTeam] = useState<TeamMembers | null>(null);
  const [day1, setDay1] = useState<Day1Status | null>(null);

  useEffect(() => {
    let cancelled = false;

    getGoogleStatus(accessToken, clientId)
      .then((status) => {
        if (!cancelled) setGoogle(status);
      })
      .catch((err) => {
        if (!cancelled) setGoogleError(err instanceof Error ? err.message : 'Failed to load connection status');
      });

    // Best-effort: manage_team-gated, so members get a 403 — hidden, not an error.
    listMembers(accessToken)
      .then((members) => {
        if (!cancelled) setTeam(members);
      })
      .catch(() => {
        // Silently omitted for roles that cannot read the team.
      });

    // Best-effort: admin-only on the backend — hidden for client roles, never an error.
    getDay1Status(accessToken, clientId, project.id)
      .then((status) => {
        if (!cancelled) setDay1(status);
      })
      .catch(() => {
        // Silently omitted when the caller cannot read pipeline status.
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, project.id]);

  if (!google && !googleError) {
    return <PortalLoading label="Loading settings" />;
  }

  return (
    <StaggerIn>
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">{project.name}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Project</CardTitle>
            <CardDescription>Basics for this workspace</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col p-0">
            {[
              ['Name', project.name],
              ['Domain', project.domain],
              ['Created', formatDate(project.createdAt)],
            ].map(([label, value], i) => (
              <div
                key={label}
                className={`flex items-baseline justify-between gap-3 px-6 py-2.5 text-sm ${i > 0 ? 'border-t border-border' : ''}`}
              >
                <p className="text-muted-foreground">{label}</p>
                <p className="shrink-0 font-medium">{value}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {team ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Account &amp; seats</CardTitle>
              <CardDescription>Your team&apos;s seat usage</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col p-0">
              {[
                ['Seats used', `${team.seatsUsed} of ${team.seatLimit}`],
                ['Team members', String(team.members.length)],
              ].map(([label, value], i) => (
                <div
                  key={label}
                  className={`flex items-baseline justify-between gap-3 px-6 py-2.5 text-sm ${i > 0 ? 'border-t border-border' : ''}`}
                >
                  <p className="text-muted-foreground">{label}</p>
                  <p className="shrink-0 font-medium">{value}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connected accounts</CardTitle>
            <CardDescription>Google services linked to your account</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {googleError ? (
              <p className="text-sm text-destructive">{googleError}</p>
            ) : google ? (
              <>
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className={`size-2 rounded-full ${connectionDot(google.gsc.connected)}`} />
                  <p className="font-medium">Search Console</p>
                  <p className="ml-auto text-muted-foreground">
                    {google.gsc.connected ? 'Connected' : 'Not connected'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className={`size-2 rounded-full ${connectionDot(google.ga.connected)}`} />
                  <p className="font-medium">Analytics</p>
                  <p className="ml-auto text-muted-foreground">
                    {google.ga.connected ? 'Connected' : 'Not connected'}
                  </p>
                </div>
                {!google.gsc.connected && !google.ga.connected ? (
                  <p className="text-xs text-muted-foreground">
                    Ask your admin to connect Google to unlock the Organic dashboard.
                  </p>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>

        {day1 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Day-1 pipeline</CardTitle>
              <CardDescription>
                Setup status
                {day1.currentStage && day1.status === 'RUNNING' ? ` — ${stageLabel(day1.currentStage)}` : null}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col p-0">
              {DAY1_STAGE_ORDER.map((stage, i) => {
                const record = day1.stages[stage];
                const status =
                  record?.status ??
                  (stage === day1.currentStage && day1.status === 'RUNNING' ? 'running' : 'pending');
                return (
                  <div
                    key={stage}
                    className={`flex items-center gap-2 px-6 py-2.5 text-sm ${i > 0 ? 'border-t border-border' : ''}`}
                  >
                    <span aria-hidden="true" className={`size-2 rounded-full ${stageDot(status)}`} />
                    <p>{stageLabel(stage)}</p>
                    <p className="ml-auto shrink-0 capitalize text-muted-foreground">{status}</p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        Settings are read-only — contact your admin to change anything on this page.
      </p>
    </div>
    </StaggerIn>
  );
}
