'use client';

import { useEffect, useState } from 'react';
import { ClipboardList } from '@/components/animate-ui/icons/clipboard-list';
import { Layers } from '@/components/animate-ui/icons/layers';
import { Link2 } from '@/components/animate-ui/icons/link-2';
import { UsersRound } from '@/components/animate-ui/icons/users-round';
import { getGoogleStatus } from '@/lib/google-api';
import { getDay1Status, type Day1Status } from '@/lib/settings-api';
import { listMembers } from '@/lib/team-api';
import type { GoogleStatus } from '@/types/google';
import type { Project } from '@/types/project';
import type { TeamMembers } from '@/types/team';
import { InlineEmpty, Section } from '@/components/portal/blocks';
import { PageHeader, PortalPage, StatusChip } from '@/components/portal/layout';
import { PortalLoading } from '@/components/portal/states';

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

const STAGE_LABEL: Record<string, string> = {
  discovery: 'Learning about your business',
  'technical-audit': 'Technical health check',
  'social-activity': 'Social channels check',
  'query-set': 'Choosing buyer questions',
  'aeo-audit': 'AI visibility check',
  competitors: 'Finding your rivals',
  'gap-analysis': 'Working out priorities',
  remediation: 'Building your Fix Plan',
  reporting: 'Writing your first report',
  notify: 'Letting you know',
};

function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? stage.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

const STAGE_WORD: Record<string, string> = {
  completed: 'Done',
  failed: 'Stopped',
  skipped: 'Skipped',
  running: 'Running now',
  pending: 'Waiting',
};

const STAGE_DOT: Record<string, string> = {
  completed: 'var(--success)',
  failed: 'var(--danger)',
  skipped: 'var(--g-line-strong)',
  running: 'var(--warning)',
  pending: 'var(--g-line)',
};

function formatDate(raw: string | null): string {
  if (!raw) return 'Unknown';
  const date = new Date(raw);
  return Number.isNaN(date.getTime())
    ? 'Unknown'
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
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

    // Best-effort: manage_team-gated, so members get a 403 and the card is hidden.
    listMembers(accessToken)
      .then((members) => {
        if (!cancelled) setTeam(members);
      })
      .catch(() => {
        // Silently omitted for roles that cannot read the team.
      });

    // Best-effort: admin-only on the backend, so client roles simply don't see it.
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

  if (!google && !googleError) return <PortalLoading label="Loading settings" />;

  const pipelineWord =
    day1?.status === 'COMPLETE' ? 'Finished' : day1?.status === 'FAILED' ? 'Stopped' : day1?.status === 'RUNNING' ? 'Running' : 'Queued';

  return (
    <PortalPage>
      <PageHeader
        eyebrow="Settings"
        title="Project settings"
        meta={<span>{project.name}</span>}
        summary="These settings are managed by Rothenhall. To change anything here, ask your Rothenhall lead."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section index={1} icon={Layers} eyebrow="Project">
          <Rows
            rows={[
              ['Name', project.name],
              ['Website', project.domain],
              ['Started', formatDate(project.createdAt)],
            ]}
          />
        </Section>

        {team ? (
          <Section index={2} icon={UsersRound} eyebrow="Your team">
            <Rows
              rows={[
                ['Seats used', `${team.seatsUsed} of ${team.seatLimit}`],
                ['People on the team', String(team.members.length)],
              ]}
            />
          </Section>
        ) : null}

        <Section index={3} icon={Link2} eyebrow="Connected accounts" description="Connecting Google unlocks your real clicks and visits.">
          {googleError ? (
            <InlineEmpty>We couldn&apos;t check your connections right now. Refresh to try again.</InlineEmpty>
          ) : google ? (
            <div className="flex flex-col gap-2.5 text-sm">
              <Connection name="Google Search Console" connected={google.gsc.connected} />
              <Connection name="Google Analytics" connected={google.ga.connected} />
              {!google.gsc.connected && !google.ga.connected ? (
                <p className="text-xs text-muted-foreground">Ask your Rothenhall lead to connect Google for you.</p>
              ) : null}
            </div>
          ) : null}
        </Section>

        {day1 ? (
          <Section
            index={4}
            icon={ClipboardList}
            eyebrow="First-day setup"
            right={<StatusChip tone={day1.status === 'COMPLETE' ? 'good' : day1.status === 'FAILED' ? 'bad' : 'watch'}>{pipelineWord}</StatusChip>}
            flush
          >
            <ul className="flex flex-col pb-2">
              {DAY1_STAGE_ORDER.map((stage) => {
                const record = day1.stages[stage];
                const status =
                  record?.status ?? (stage === day1.currentStage && day1.status === 'RUNNING' ? 'running' : 'pending');
                return (
                  <li key={stage} className="flex items-center gap-2.5 border-t border-border px-5 py-2.5 text-sm">
                    <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: STAGE_DOT[status] ?? STAGE_DOT.pending }} />
                    <span>{stageLabel(stage)}</span>
                    <span className="ml-auto shrink-0 text-muted-foreground">{STAGE_WORD[status] ?? status}</span>
                  </li>
                );
              })}
            </ul>
          </Section>
        ) : null}
      </div>
    </PortalPage>
  );
}

function Rows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="flex flex-col text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-3 border-t border-border py-2.5 first:border-t-0 first:pt-0">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="truncate font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Connection({ name, connected }: { name: string; connected: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <p className="font-medium">{name}</p>
      <span className="ml-auto">
        <StatusChip tone={connected ? 'good' : 'neutral'}>{connected ? 'Connected' : 'Not connected'}</StatusChip>
      </span>
    </div>
  );
}
