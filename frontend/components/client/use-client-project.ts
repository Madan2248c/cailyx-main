import { useEffect, useState } from 'react';
import { listProjects } from '@/lib/projects-api';
import type { Project } from '@/types/project';

/**
 * The client's project for a portal route. `undefined` while loading,
 * `null` when missing/failed — pages render loading, content, or not-found.
 */
export function useClientProject(
  accessToken: string | null,
  clientId: string,
  projectId: string,
): Project | null | undefined {
  const [project, setProject] = useState<Project | null | undefined>(undefined);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    listProjects(accessToken, clientId)
      .then((projects) => {
        if (!cancelled) setProject(projects.find((p) => p.id === projectId) ?? null);
      })
      .catch(() => {
        if (!cancelled) setProject(null);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, projectId]);

  return project;
}
