'use client';

import { useState, type ReactNode } from 'react';
import { CADENCE_OPTIONS, ScheduleChip, Segmented, cadenceLabel } from '@/components/admin/admin-ui';
import { StatusChip } from '@/components/portal/layout';
import {
  setSocialActivitySchedule,
  setTechnicalAuditSchedule,
  type ScheduleCadence,
  type SocialActivitySchedule,
  type TechnicalAuditSchedule,
} from '@/lib/schedules-api';
import type { Project } from '@/types/project';

/** One line of the schedule list: what it is, where it stands, and how to change it. */
export function ScheduleRow({
  title,
  description,
  chip,
  children,
  footer,
}: {
  title: string;
  description: ReactNode;
  chip: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border px-5 py-4 first:border-t-0">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{title}</p>
            {chip}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        {children ? <div className="flex shrink-0 flex-wrap items-center gap-3">{children}</div> : null}
      </div>
      {footer}
    </div>
  );
}

/** A row for something that only runs on demand, so it is honest about having no schedule. */
export function OnDemandRow({ title, description }: { title: string; description: string }) {
  return <ScheduleRow title={title} description={description} chip={<StatusChip tone="neutral">On demand</StatusChip>} />;
}

export interface ScheduleFeedback {
  tone: 'ok' | 'error';
  text: string;
}

export function ProjectScheduleCard({
  accessToken,
  clientId,
  project,
  technical,
  social,
  onChanged,
  onFeedback,
}: {
  accessToken: string;
  clientId: string;
  project: Project;
  technical: TechnicalAuditSchedule | null;
  social: SocialActivitySchedule | null;
  onChanged: () => void;
  onFeedback: (feedback: ScheduleFeedback) => void;
}) {
  // Local copies so a control settles the moment the save returns, instead of
  // snapping back while the parent reloads. They re-sync whenever the parent
  // hands down fresher data.
  const [tech, setTech] = useState(technical);
  const [soc, setSoc] = useState(social);
  const [seenTechnical, setSeenTechnical] = useState(technical);
  const [seenSocial, setSeenSocial] = useState(social);
  const [pending, setPending] = useState<'technical' | 'social' | null>(null);

  // Adjusted during render (not in an effect) when the parent hands down fresh data.
  if (seenTechnical !== technical) {
    setSeenTechnical(technical);
    setTech(technical);
  }
  if (seenSocial !== social) {
    setSeenSocial(social);
    setSoc(social);
  }

  async function saveTechnical(cadence: ScheduleCadence) {
    setPending('technical');
    try {
      setTech(await setTechnicalAuditSchedule(accessToken, clientId, project.id, cadence));
      onFeedback({ tone: 'ok', text: `${project.name}: technical audits set to ${cadenceLabel(cadence).toLowerCase()}.` });
      onChanged();
    } catch (err) {
      onFeedback({ tone: 'error', text: `${project.name}: ${err instanceof Error ? err.message : 'Could not update the technical audit schedule.'}` });
    } finally {
      setPending(null);
    }
  }

  async function saveSocial(cadence: ScheduleCadence, spendOptIn?: boolean) {
    setPending('social');
    try {
      setSoc(await setSocialActivitySchedule(accessToken, clientId, project.id, cadence, spendOptIn === undefined ? {} : { spendOptIn }));
      onFeedback({
        tone: 'ok',
        text:
          spendOptIn === undefined
            ? `${project.name}: social activity set to ${cadenceLabel(cadence).toLowerCase()}.`
            : `${project.name}: scheduled social runs ${spendOptIn ? 'may now spend' : 'no longer spend'}.`,
      });
      onChanged();
    } catch (err) {
      onFeedback({ tone: 'error', text: `${project.name}: ${err instanceof Error ? err.message : 'Could not update the social activity schedule.'}` });
    } finally {
      setPending(null);
    }
  }

  const socialCadence = soc?.cadence ?? 'MANUAL_ONLY';
  const socialWaiting = soc !== null && soc.active && !soc.spendOptIn;

  return (
    <>
      <ScheduleRow
        title="Technical audit"
        description="A fresh crawl of the site's health: speed, links, markup."
        chip={<ScheduleChip schedule={tech} />}
      >
        <Segmented
          label={`Technical audit cadence for ${project.name}`}
          value={tech?.cadence ?? 'MANUAL_ONLY'}
          options={CADENCE_OPTIONS}
          disabled={pending !== null}
          onChange={(cadence) => void saveTechnical(cadence)}
        />
      </ScheduleRow>

      <ScheduleRow
        title="Social activity"
        description={
          socialWaiting
            ? 'Scheduled, but nothing runs until you allow spend. The scrapers cost money, so the scheduler waits for your opt-in.'
            : 'Recent posting on the client\'s social profiles. The scrapers cost money, so scheduled runs need your opt-in.'
        }
        chip={
          <>
            <ScheduleChip schedule={soc} />
            {socialWaiting ? <StatusChip tone="watch">Waiting for spend opt-in</StatusChip> : null}
          </>
        }
      >
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="size-4"
            checked={soc?.spendOptIn ?? false}
            disabled={pending !== null}
            onChange={(e) => void saveSocial(socialCadence, e.target.checked)}
          />
          Allow scheduled spend
        </label>
        <Segmented
          label={`Social activity cadence for ${project.name}`}
          value={socialCadence}
          options={CADENCE_OPTIONS}
          disabled={pending !== null}
          onChange={(cadence) => void saveSocial(cadence)}
        />
      </ScheduleRow>
    </>
  );
}
