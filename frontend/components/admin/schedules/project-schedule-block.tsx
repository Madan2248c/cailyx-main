'use client';

import { ProjectScheduleCard } from '@/components/admin/schedules/project-schedule-card';
import { DataforseoScheduleCard } from '@/components/admin/schedules/dataforseo-schedule-card';
import type { SocialActivitySchedule, TechnicalAuditSchedule } from '@/lib/schedules-api';
import type { Project } from '@/types/project';

/**
 * One project's full schedule block: the existing tech/social card
 * (untouched) plus the DataForSEO card. Keeps the schedules page diff to
 * an import + tag swap.
 */
export function ProjectScheduleBlock({
  accessToken,
  clientId,
  project,
  technical,
  social,
  onChanged,
}: {
  accessToken: string;
  clientId: string;
  project: Project;
  technical: TechnicalAuditSchedule | null;
  social: SocialActivitySchedule | null;
  onChanged: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <ProjectScheduleCard
        accessToken={accessToken}
        clientId={clientId}
        project={project}
        technical={technical}
        social={social}
        onChanged={onChanged}
      />
      <DataforseoScheduleCard
        accessToken={accessToken}
        clientId={clientId}
        project={project}
        onChanged={onChanged}
      />
    </div>
  );
}
