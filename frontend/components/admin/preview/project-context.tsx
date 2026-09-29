'use client';

import { createContext, useContext } from 'react';
import type { Project } from '@/types/project';

const ProjectContext = createContext<Project | null>(null);

export const PreviewProjectProvider = ProjectContext.Provider;

/** The project being previewed. Only valid under the preview's project layout. */
export function usePreviewProject(): Project {
  const project = useContext(ProjectContext);
  if (!project) throw new Error('usePreviewProject must be used inside the preview project layout');
  return project;
}
