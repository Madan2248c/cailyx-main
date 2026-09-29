'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Notice } from '@/components/admin/admin-ui';
import { ProjectScheduleBlock } from '@/components/admin/schedules/project-schedule-block';
import { useProjectSchedules } from '@/components/admin/schedules/use-project-schedules';
import { InlineEmpty } from '@/components/portal/blocks';
import type { Project } from '@/types/project';

/**
 * Per-client schedules for the client-detail page. It reuses the same tiles
 * and fetchers as /admin/schedules, so a change here behaves identically there.
 */
export function ClientSchedulesSection({
  accessToken,
  clientId,
  projects,
}: {
  accessToken: string;
  clientId: string;
  projects: Project[] | null;
}) {
  const { schedules, error, refresh } = useProjectSchedules(accessToken, clientId, projects);

  return (
    <section aria-labelledby="client-schedules-heading" className="mt-2 flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="g-eyebrow">Schedules</p>
          <h2 id="client-schedules-heading" className="text-lg font-semibold leading-snug">
            What runs on its own
          </h2>
        </div>
        <Link
          href="/admin/schedules"
          className="inline-flex items-center gap-1 rounded text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          All schedules <ArrowUpRight aria-hidden className="size-4" />
        </Link>
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}

      {projects === null ? (
        <InlineEmpty>Loading schedules…</InlineEmpty>
      ) : projects.length === 0 ? (
        <InlineEmpty>Schedules appear once this client has a project.</InlineEmpty>
      ) : (
        projects.map((project, i) => (
          <ProjectScheduleBlock
            key={project.id}
            index={i}
            accessToken={accessToken}
            clientId={clientId}
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
