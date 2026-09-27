'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useClientProject } from '@/components/client/use-client-project';
import { ConnectGoogle } from '@/components/google/ConnectGoogle';
import { GaSection } from '@/components/google/GaSection';
import { GscDashboard } from '@/components/google/GscDashboard';
import { useAuth } from '@/contexts/auth-context';
import { getGoogleStatus, getSearchConsole } from '@/lib/google-api';
import type { GoogleStatus, GscOverview } from '@/types/google';

type GscState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; overview: GscOverview };

export default function OrganicPage() {
  const params = useParams<{ id: string }>();
  const { user, accessToken } = useAuth();
  const project = useClientProject(accessToken, user?.clientId ?? '', params.id);
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [gsc, setGsc] = useState<GscState>({ status: 'loading' });

  const clientId = user?.clientId ?? null;

  // A new project or a fresh Google grant resets the data fetch (handled
  // during render, not in an effect, so no stale fetch can win).
  const fetchKey =
    googleStatus?.gsc.connected && project ? `${project.id}` : null;
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
    let cancelled = false;

    getSearchConsole(accessToken, clientId, projectId)
      .then((overview) => {
        if (!cancelled) setGsc({ status: 'ready', overview });
      })
      .catch((err) => {
        if (!cancelled) {
          setGsc({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load Search Console' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, fetchKey, project]);

  if (project === undefined || !user || !accessToken || !clientId || !googleStatus) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
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

  const canEdit = user.role === 'CLIENT_POC';

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
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Organic</h1>
        <p className="text-sm text-muted-foreground">{project.name} · Google Search Console</p>
      </div>
      {gsc.status === 'loading' ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Loading search performance…</p>
          </CardContent>
        </Card>
      ) : null}
      {gsc.status === 'error' ? (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-6">
            <p className="text-sm text-destructive">{gsc.message}</p>
            <p className="text-sm text-muted-foreground">
              If this account has no property for {project.domain}, connect an account that does.
            </p>
          </CardContent>
        </Card>
      ) : null}
      {gsc.status === 'ready' ? <GscDashboard overview={gsc.overview} /> : null}
      <GaSection
        accessToken={accessToken}
        clientId={clientId}
        projectId={project.id}
        connected={googleStatus.ga.connected}
        canEdit={canEdit}
      />
    </div>
  );
}
