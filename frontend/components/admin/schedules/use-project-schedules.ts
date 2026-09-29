'use client';

import { useCallback } from 'react';
import { useLoad } from '@/components/admin/use-load';
import {
  getSocialActivitySchedule,
  getTechnicalAuditSchedule,
  type SocialActivitySchedule,
  type TechnicalAuditSchedule,
} from '@/lib/schedules-api';
import type { Project } from '@/types/project';

export interface ProjectSchedules {
  technical: TechnicalAuditSchedule | null;
  social: SocialActivitySchedule | null;
}

async function loadSchedules(
  accessToken: string,
  clientId: string,
  projects: Project[],
): Promise<Record<string, ProjectSchedules>> {
  const entries = await Promise.all(
    projects.map(async (project) => {
      const [technical, social] = await Promise.all([
        getTechnicalAuditSchedule(accessToken, clientId, project.id).catch(() => null),
        getSocialActivitySchedule(accessToken, clientId, project.id).catch(() => null),
      ]);
      return [project.id, { technical, social }] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * The technical and social schedules for a client's projects, keyed by
 * project id. `refresh` re-reads them after a save. DataForSEO cards load
 * their own schedule.
 */
export function useProjectSchedules(accessToken: string, clientId: string, projects: Project[] | null) {
  const load = useCallback(
    () => (projects && projects.length > 0 ? loadSchedules(accessToken, clientId, projects) : Promise.resolve({})),
    [accessToken, clientId, projects],
  );
  const { data, error, reload } = useLoad<Record<string, ProjectSchedules>>(accessToken && projects ? load : null, 'Failed to load schedules');

  return { schedules: data ?? {}, error, refresh: reload };
}
