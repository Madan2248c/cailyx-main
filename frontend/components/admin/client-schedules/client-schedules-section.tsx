'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ProjectScheduleBlock } from '@/components/admin/schedules/project-schedule-block';
import { Card, CardContent } from '@/components/ui/card';
import {
  getSocialActivitySchedule,
  getTechnicalAuditSchedule,
  type SocialActivitySchedule,
  type TechnicalAuditSchedule,
} from '@/lib/schedules-api';
import type { Project } from '@/types/project';

interface ProjectSchedules {
  technical: TechnicalAuditSchedule | null;
  social: SocialActivitySchedule | null;
}

/**
 * Per-client schedules section for the client-detail page.
 * Reuses the global schedules UI (ProjectScheduleBlock) and fetchers
 * (lib/schedules-api + self-loading DataForSEO card) so save/collect
 * behave exactly as on /admin/schedules.
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
  const [schedules, setSchedules] = useState<Record<string, ProjectSchedules>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projects || projects.length === 0) return;
    try {
      const entries = await Promise.all(
        projects.map(async (project) => {
          const [technical, social] = await Promise.all([
            getTechnicalAuditSchedule(accessToken, clientId, project.id).catch(() => null),
            getSocialActivitySchedule(accessToken, clientId, project.id).catch(() => null),
          ]);
          return [project.id, { technical, social }] as const;
        }),
      );
      setSchedules(Object.fromEntries(entries));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schedules');
    }
  }, [accessToken, clientId, projects]);

  useEffect(() => {
    if (!accessToken || !projects || projects.length === 0) return;
    let cancelled = false;

    Promise.all(
      projects.map(async (project) => {
        const [technical, social] = await Promise.all([
          getTechnicalAuditSchedule(accessToken, clientId, project.id).catch(() => null),
          getSocialActivitySchedule(accessToken, clientId, project.id).catch(() => null),
        ]);
        return [project.id, { technical, social }] as const;
      }),
    )
      .then((entries) => {
        if (!cancelled) setSchedules(Object.fromEntries(entries));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load schedules');
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, projects]);

  return (
    <section className="mt-6 flex flex-col gap-3 border-t border-border pt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Schedules</h2>
        <Link href="/admin/schedules" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          View all schedules →
        </Link>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {projects === null ? (
        <p className="text-sm text-muted-foreground">Loading schedules…</p>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">No projects yet.</CardContent>
        </Card>
      ) : (
        projects.map((project) => (
          <ProjectScheduleBlock
            key={project.id}
            accessToken={accessToken}
            clientId={clientId}
            project={project}
            technical={schedules[project.id]?.technical ?? null}
            social={schedules[project.id]?.social ?? null}
            onChanged={refresh}
          />
        ))
      )}
    </section>
  );
}
