'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/portal/button';
import { Card, CardContent } from '@/components/ui/card';
import { useClientProject } from '@/components/client/use-client-project';
import { ConnectGoogle } from '@/components/google/ConnectGoogle';
import { GaSection } from '@/components/google/GaSection';
import { GscKpis, GscClicksChart, GscTopQueries, IndexCoverage } from '@/components/google/GscDashboard';
import { GscHighlights, GscPageTables } from '@/components/google/GscInsights';
import { PropertyPicker } from '@/components/google/PropertyPicker';
import { useAuth } from '@/contexts/auth-context';
import { getGoogleStatus, getSearchConsole, listGscSites, startGoogleConnect } from '@/lib/google-api';
import type { GoogleStatus, GscOverview } from '@/types/google';
import { PortalLoading, Skeleton } from '@/components/portal/states';
import { MetaDot, PageHeader, PortalPage } from '@/components/portal/layout';

type GscState =
  | { status: 'loading' }
  | { status: 'error'; message: string; noSite: boolean; scopeMissing: boolean }
  | { status: 'ready'; overview: GscOverview };

function SitePicker({
  accessToken,
  clientId,
  projectId,
  onPick,
}: {
  accessToken: string;
  clientId: string;
  projectId: string;
  onPick: (siteUrl: string) => void;
}) {
  const [sites, setSites] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listGscSites(accessToken, clientId, projectId)
      .then((list) => {
        if (!cancelled) setSites(list);
      })
      .catch(() => {
        if (!cancelled) setSites([]);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, projectId]);

  return (
    <PropertyPicker
      title="Choose a Search Console property"
      description="We couldn't find a Search Console property for this website. Pick the right one to see its data."
      items={(sites ?? []).map((s) => ({ key: s, label: s }))}
      onPick={onPick}
      isLoading={sites === null}
    />
  );
}

export default function OrganicPage() {
  const params = useParams<{ id: string }>();
  const { user, accessToken } = useAuth();
  const project = useClientProject(accessToken, user?.clientId ?? '', params.id);
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [gsc, setGsc] = useState<GscState>({ status: 'loading' });

  const clientId = user?.clientId ?? null;

  // A new project, a fresh Google grant, or a manual property pick resets
  // the data fetch (handled during render, not in an effect, so no stale
  // fetch can win). The pick is scoped to its project — switching projects
  // never leaks another project's property in.
  const [sitePick, setSitePick] = useState<{ projectId: string; site: string } | null>(null);
  const selectedSite =
    sitePick && project && sitePick.projectId === project.id ? sitePick.site : null;
  const fetchKey =
    googleStatus?.gsc.connected && project ? `${project.id}:${selectedSite ?? 'auto'}` : null;
  const [fetchedKey, setFetchedKey] = useState<string | null>(null);
  if (fetchedKey !== fetchKey) {
    setFetchedKey(fetchKey);
    setGsc({ status: 'loading' });
  }

  useEffect(() => {
    if (!accessToken || !clientId) return;
    let cancelled = false;

    getGoogleStatus(accessToken, clientId)
      .then((status) => {
        if (!cancelled) setGoogleStatus(status);
      })
      .catch(() => {
        if (!cancelled) setGoogleStatus({ gsc: { connected: false }, ga: { connected: false } });
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId]);

  useEffect(() => {
    if (!accessToken || !clientId || !fetchKey || !project || project === null) return;
    const projectId = project.id;
    const site = selectedSite;
    let cancelled = false;

    getSearchConsole(accessToken, clientId, projectId, site ?? undefined)
      .then((overview) => {
        if (!cancelled) setGsc({ status: 'ready', overview });
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load Search Console';
          setGsc({
            status: 'error',
            message,
            noSite: message.includes('google-no-site'),
            scopeMissing: message.includes('google-scope-missing'),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, fetchKey, project, selectedSite]);

  const canEdit = user?.role === 'CLIENT_POC';
  const [pickingSite, setPickingSite] = useState(false);
  const [reconnectPending, setReconnectPending] = useState(false);
  const [reconnectError, setReconnectError] = useState<string | null>(null);

  async function reconnectGsc() {
    if (!accessToken || !clientId) return;
    setReconnectError(null);
    setReconnectPending(true);
    try {
      await startGoogleConnect(accessToken, clientId, 'gsc');
    } catch (err) {
      setReconnectError(err instanceof Error ? err.message : 'Something went wrong');
      setReconnectPending(false);
    }
  }

  if (project === undefined || !user || !accessToken || !clientId || !googleStatus) {
    return <PortalLoading label="Loading" />;
  }

  if (project === null) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col gap-4 pt-6">
            <p className="text-sm text-muted-foreground">
              This project doesn&apos;t exist or doesn&apos;t belong to your account.
            </p>
            <Button variant="secondary" nativeButton={false} render={<Link href="/client">Back to projects</Link>} />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!googleStatus.gsc.connected) {
    return (
      <ConnectGoogle
        accessToken={accessToken}
        clientId={clientId}
        canEdit={canEdit}
        showAnalytics={!googleStatus.ga.connected}
      />
    );
  }

  return (
    <PortalPage>
      <PageHeader
        eyebrow="Performance"
        title="Google search"
        meta={
          <>
            <span>{project.name}</span>
            <MetaDot />
            <span>From your Google Search Console</span>
          </>
        }
        summary="Real numbers from Google: how often your site shows up in search, how many people click and which searches bring them."
        actions={
          gsc.status === 'ready' && canEdit ? (
            <Button variant="outline" size="sm" onClick={() => setPickingSite((v) => !v)}>
              {pickingSite ? 'Cancel' : 'Switch website'}
            </Button>
          ) : null
        }
      />
      {pickingSite ? (
        <SitePicker
          accessToken={accessToken}
          clientId={clientId}
          projectId={project.id}
          onPick={(site) => {
            setSitePick({ projectId: project.id, site });
            setPickingSite(false);
          }}
        />
      ) : null}
      {gsc.status === 'loading' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-label="Loading search performance">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : null}
      {gsc.status === 'error' && gsc.noSite && accessToken && clientId ? (
        <SitePicker
          accessToken={accessToken}
          clientId={clientId}
          projectId={project.id}
          onPick={(site) => setSitePick({ projectId: project.id, site })}
        />
      ) : null}
      {gsc.status === 'error' && gsc.scopeMissing ? (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-6">
            <p className="text-sm">
              Google Search Console access was removed or not fully granted, so Google won&apos;t share your data yet.
            </p>
            <p className="text-sm text-muted-foreground">
              Reconnect and tick every box on Google&apos;s permission screen.
            </p>
            <div>
              <Button onClick={reconnectGsc} disabled={!canEdit || reconnectPending}>
                {reconnectPending ? 'Redirecting…' : 'Reconnect Search Console'}
              </Button>
            </div>
            {!canEdit ? (
              <p className="text-sm text-muted-foreground">Only your company&apos;s main contact can reconnect Google.</p>
            ) : null}
            {reconnectError ? <p className="text-sm text-destructive">{reconnectError}</p> : null}
          </CardContent>
        </Card>
      ) : null}
      {gsc.status === 'error' && !gsc.noSite && !gsc.scopeMissing ? (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-6">
            <p className="text-sm font-medium">We couldn&apos;t load your Google search data.</p>
            <p className="text-sm text-muted-foreground">
              If the connected Google account doesn&apos;t manage {project.domain}, connect one that does.
            </p>
            <p className="text-xs text-muted-foreground/80">Details: {gsc.message}</p>
          </CardContent>
        </Card>
      ) : null}
      {gsc.status === 'ready' ? (
        <>
          <GscKpis overview={gsc.overview} />
          <GscHighlights overview={gsc.overview} />
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <GscClicksChart overview={gsc.overview} />
            </div>
            <div className="lg:col-span-2">
              <IndexCoverage overview={gsc.overview} />
            </div>
          </div>
          <GscPageTables overview={gsc.overview} />
          <GscTopQueries overview={gsc.overview} />
        </>
      ) : null}
      <GaSection
        accessToken={accessToken}
        clientId={clientId}
        projectId={project.id}
        connected={googleStatus.ga.connected}
        canEdit={canEdit}
      />
    </PortalPage>
  );
}
