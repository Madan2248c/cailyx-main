'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Monogram, Notice } from '@/components/admin/admin-ui';
import { useLoad } from '@/components/admin/use-load';
import { Section } from '@/components/portal/blocks';
import { PageHeader, PortalPage } from '@/components/portal/layout';
import { EmptyState, PortalLoading } from '@/components/portal/states';
import { useAuth } from '@/contexts/auth-context';
import { listProjects } from '@/lib/projects-api';
import type { Project } from '@/types/project';

/** Picks which of the client's projects to step into. With only one, it goes straight there. */
export default function PreviewProjectPickerPage() {
  const { accessToken } = useAuth();
  const { clientId } = useParams<{ clientId: string }>();
  const router = useRouter();
  const load = useCallback(() => listProjects(accessToken ?? '', clientId), [accessToken, clientId]);
  const { data: projects, error, loading } = useLoad<Project[]>(accessToken ? load : null, 'Failed to load projects');

  const only = projects && projects.length === 1 ? projects[0] : null;
  useEffect(() => {
    if (only) router.replace(`/admin/preview/${clientId}/projects/${only.id}`);
  }, [only, clientId, router]);

  if ((loading && !projects) || only) return <PortalLoading label="Opening the client's portal" />;

  return (
    <PortalPage>
      <PageHeader eyebrow="Preview" title="Choose a project" summary="You'll see exactly what the client sees, with your admin controls on top." />

      {error ? <Notice tone="error">{error}</Notice> : null}

      {projects && projects.length === 0 ? (
        <Section eyebrow="Projects">
          <EmptyState title="No projects to preview" body="This client has no projects yet. Create one from the client page, then come back." />
          <div className="mb-6 flex justify-center">
            <Link href={`/admin/clients/${clientId}`} className="text-sm font-medium underline underline-offset-4">
              Open the client page
            </Link>
          </div>
        </Section>
      ) : null}

      {projects && projects.length > 1 ? (
        <Section eyebrow="Projects" flush>
          <ul className="flex flex-col pb-1">
            {projects.map((project) => (
              <li key={project.id} className="border-t border-border first:border-t-0">
                <Link
                  href={`/admin/preview/${clientId}/projects/${project.id}`}
                  className="g-row-link flex items-center gap-3 px-5 py-3.5 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  <Monogram name={project.name} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold">{project.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{project.domain}</span>
                  </span>
                  <ArrowUpRight aria-hidden className="g-row-arrow size-4 shrink-0 opacity-50" />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </PortalPage>
  );
}
