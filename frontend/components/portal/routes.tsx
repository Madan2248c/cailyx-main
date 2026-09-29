'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Where a project's pages live. The client portal serves them under
 * `/client/projects/:id`; the admin preview serves the very same screens under
 * its own path so every link inside a tab keeps the admin in the preview.
 */
type ProjectBase = (projectId: string) => string;

const clientBase: ProjectBase = (projectId) => `/client/projects/${projectId}`;

const RoutesContext = createContext<ProjectBase>(clientBase);

export function PortalRoutesProvider({ projectBase, children }: { projectBase: ProjectBase; children: ReactNode }) {
  return <RoutesContext.Provider value={projectBase}>{children}</RoutesContext.Provider>;
}

/** The path prefix for a project's pages, e.g. `/client/projects/abc`. Append `/plan`, `/competitors` and so on. */
export function useProjectBase(projectId: string): string {
  return useContext(RoutesContext)(projectId);
}
