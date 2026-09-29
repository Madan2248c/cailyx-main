'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, type ReactNode } from 'react';
import { PreviewProjectProvider } from '@/components/admin/preview/project-context';
import { PreviewSidebar } from '@/components/admin/preview/preview-sidebar';
import { useLoad } from '@/components/admin/use-load';
import { Button } from '@/components/portal/button';
import { PortalPage, Tile } from '@/components/portal/layout';
import { EmptyState, PortalLoading } from '@/components/portal/states';
import { PageTransition } from '@/components/portal/reveal';
import { useAuth } from '@/contexts/auth-context';
import { listProjects } from '@/lib/projects-api';
import type { Project } from '@/types/project';

/** The client's own frame: their sidebar on the left, their pages on the right. */
export default function PreviewProjectLayout({ children }: { children: ReactNode }) {
  const { clientId, projectId } = useParams<{ clientId: string; projectId: string }>();
  const { accessToken } = useAuth();
  const load = useCallback(async () => (await listProjects(accessToken ?? '', clientId)).find((p) => p.id === projectId) ?? null, [accessToken, clientId, projectId]);
  const { data: project, loading, error } = useLoad<Project | null>(accessToken ? load : null, 'Failed to load the project');

  if (loading) return <PortalLoading label="Loading the client's portal" />;

  if (!project) {
    return (
      <PortalPage>
        <Tile>
          <EmptyState
            title="Project not found"
            body={error ?? "This project doesn't exist, or it doesn't belong to this client. Go back to the project list to pick another."}
          />
          <div className="mb-6 flex justify-center">
            <Button variant="outline" nativeButton={false} render={<Link href={`/admin/preview/${clientId}`}>Choose a project</Link>} />
          </div>
        </Tile>
      </PortalPage>
    );
  }

  return (
    <PreviewProjectProvider value={project}>
      <div className="flex flex-1 flex-col md:flex-row">
        <PreviewSidebar project={project} />
        <main id="main-content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col bg-canvas outline-none">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </PreviewProjectProvider>
  );
}
