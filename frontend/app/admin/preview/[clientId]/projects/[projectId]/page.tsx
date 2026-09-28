'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AiTab } from '@/components/ai/AiTab';
import { SectionErrorBoundary } from '@/components/admin/preview/section-error-boundary';
import { OrganicPreview } from '@/components/admin/preview/organic-preview';
import { CompetitorsTab } from '@/components/competitors/CompetitorsTab';
import { DashboardTab } from '@/components/dashboard/DashboardTab';
import { TechnicalTab } from '@/components/performance/TechnicalTab';
import { ReportsTab } from '@/components/reports/ReportsTab';
import { SocialTab } from '@/components/social/SocialTab';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { PortalMotion } from '@/components/portal/motion';
import { listProjects } from '@/lib/projects-api';
import { listClients } from '@/lib/team-api';
import type { Project } from '@/types/project';

const TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'technical', label: 'Technical' },
  { key: 'reports', label: 'Reports' },
  { key: 'competitors', label: 'Competitors' },
  { key: 'organic', label: 'Organic' },
  { key: 'ai', label: 'AI' },
  { key: 'social', label: 'Social' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function AdminPreviewProjectPage() {
  const { user, accessToken, isLoading } = useAuth();
  const router = useRouter();
  const params = useParams<{ clientId: string; projectId: string }>();
  const clientId = params.clientId;
  const projectId = params.projectId;

  const [clientName, setClientName] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');

  useEffect(() => {
    if (!isLoading && (!user || user.role !== 'ADMIN')) {
      router.replace('/dashboard');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    listClients(accessToken)
      .then((clients) => {
        if (!cancelled) setClientName(clients.find((c) => c.id === clientId)?.name ?? clientId);
      })
      .catch(() => {
        if (!cancelled) setClientName(clientId);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    listProjects(accessToken, clientId)
      .then((projects) => {
        if (!cancelled) setProject(projects.find((p) => p.id === projectId) ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load project');
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, projectId]);

  if (isLoading || !user || user.role !== 'ADMIN') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!accessToken) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-10">
      <div>
        <Button variant="ghost" size="sm" onClick={() => router.push(`/admin/preview/${clientId}`)}>
          ← Projects
        </Button>
      </div>
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
        <p className="text-sm font-medium">Previewing {clientName ?? '…'} — read-only</p>
        <p className="text-sm text-muted-foreground">
          You are viewing this client&apos;s data as an admin. Nothing here can be edited.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {project === undefined && !error ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : project === null || project === undefined ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              This project doesn&apos;t exist or doesn&apos;t belong to this client.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div>
            <h1 className="text-xl font-semibold">{project.name}</h1>
            <p className="text-sm text-muted-foreground">{project.domain}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {TABS.map((tab) => (
              <Button
                key={tab.key}
                size="sm"
                variant={activeTab === tab.key ? 'default' : 'outline'}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </Button>
            ))}
          </div>
          {/* Same theme scope as the client portal, so the preview matches what the client sees. */}
          <PortalMotion>
          <div className="theme-graphite flex flex-col overflow-hidden rounded-xl border border-border bg-canvas">
          <SectionErrorBoundary key={activeTab} label={TABS.find((t) => t.key === activeTab)?.label ?? activeTab}>
            {activeTab === 'dashboard' ? (
              <DashboardTab
                accessToken={accessToken}
                clientId={clientId}
                projectId={project.id}
                projectName={project.name}
                projectDomain={project.domain}
              />
            ) : null}
            {activeTab === 'technical' ? (
              <TechnicalTab
                accessToken={accessToken}
                clientId={clientId}
                projectId={project.id}
                projectName={project.name}
              />
            ) : null}
            {activeTab === 'reports' ? (
              <ReportsTab
                accessToken={accessToken}
                clientId={clientId}
                projectId={project.id}
                projectName={project.name}
              />
            ) : null}
            {activeTab === 'competitors' ? (
              <CompetitorsTab
                accessToken={accessToken}
                clientId={clientId}
                projectId={project.id}
                projectName={project.name}
                canEdit={false}
              />
            ) : null}
            {activeTab === 'organic' ? (
              <OrganicPreview
                accessToken={accessToken}
                clientId={clientId}
                projectId={project.id}
                projectName={project.name}
                projectDomain={project.domain}
              />
            ) : null}
            {activeTab === 'ai' ? (
              <AiTab
                accessToken={accessToken}
                clientId={clientId}
                projectId={project.id}
                projectName={project.name}
              />
            ) : null}
            {activeTab === 'social' ? (
              <SocialTab
                accessToken={accessToken}
                clientId={clientId}
                projectId={project.id}
                projectName={project.name}
              />
            ) : null}
          </SectionErrorBoundary>
          </div>
          </PortalMotion>
        </>
      )}
    </div>
  );
}
