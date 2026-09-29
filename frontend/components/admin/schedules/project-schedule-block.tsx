'use client';

import { useState } from 'react';
import { Monogram, Notice } from '@/components/admin/admin-ui';
import { DataforseoScheduleCard } from '@/components/admin/schedules/dataforseo-schedule-card';
import { OnDemandRow, ProjectScheduleCard, type ScheduleFeedback } from '@/components/admin/schedules/project-schedule-card';
import { Tile } from '@/components/portal/layout';
import type { SocialActivitySchedule, TechnicalAuditSchedule } from '@/lib/schedules-api';
import type { Project } from '@/types/project';

/**
 * One project's full schedule tile: technical audit, social activity and
 * DataForSEO (the three that have schedule endpoints), then the two that run
 * on demand. Saves report to a banner at the foot of the tile.
 */
export function ProjectScheduleBlock({
  accessToken,
  clientId,
  project,
  technical,
  social,
  onChanged,
  index = 0,
}: {
  accessToken: string;
  clientId: string;
  project: Project;
  technical: TechnicalAuditSchedule | null;
  social: SocialActivitySchedule | null;
  onChanged: () => void;
  index?: number;
}) {
  const [feedback, setFeedback] = useState<ScheduleFeedback | null>(null);

  return (
    <Tile index={index} className="p-0">
      <div className="flex items-center gap-3 px-5 pt-5 pb-4">
        <Monogram name={project.name} />
        <div className="flex min-w-0 flex-col">
          <h3 className="truncate text-base font-semibold leading-snug">{project.name}</h3>
          <p className="truncate text-xs text-muted-foreground">{project.domain}</p>
        </div>
      </div>

      <div className="border-t border-border">
        <ProjectScheduleCard
          accessToken={accessToken}
          clientId={clientId}
          project={project}
          technical={technical}
          social={social}
          onChanged={onChanged}
          onFeedback={setFeedback}
        />
        <DataforseoScheduleCard
          accessToken={accessToken}
          clientId={clientId}
          project={project}
          onChanged={onChanged}
          onFeedback={setFeedback}
        />
        <OnDemandRow title="Reports" description="Monthly reports are generated on demand. The backend has no report schedule yet." />
        <OnDemandRow title="AEO audit" description="AI-answer audits are created and run on demand. The backend has no AEO schedule yet." />
      </div>

      {feedback ? (
        <div className="border-t border-border px-5 py-3">
          <Notice tone={feedback.tone} onDismiss={() => setFeedback(null)}>
            {feedback.text}
          </Notice>
        </div>
      ) : null}
    </Tile>
  );
}
