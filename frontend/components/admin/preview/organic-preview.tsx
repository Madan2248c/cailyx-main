'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ConnectGoogle } from '@/components/google/ConnectGoogle';
import { GaSection } from '@/components/google/GaSection';
import { GscKpis, GscClicksChart, GscTopQueries, IndexCoverage } from '@/components/google/GscDashboard';
import { GscHighlights, GscPageTables } from '@/components/google/GscInsights';
import { PropertyPicker } from '@/components/google/PropertyPicker';
import { getGoogleStatus, getSearchConsole, listGscSites } from '@/lib/google-api';
import type { GoogleStatus, GscOverview } from '@/types/google';

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
      description="This account has no property matching the project domain — pick one to view its data."
      items={(sites ?? []).map((s) => ({ key: s, label: s }))}
      onPick={onPick}
      isLoading={sites === null}
    />
  );
}

/**
 * Read-only Organic (Search Console + Analytics) section for admin preview.
 * Same data path as the client Organic page, but with the preview clientId
 * passed explicitly and editing/reconnect disabled (canEdit=false).
 */
export function OrganicPreview({
  accessToken,
  clientId,
  projectId,
  projectName,
  projectDomain,
}: {
  accessToken: string;
  clientId: string;
  projectId: string;
  projectName: string;
  projectDomain: string;
}) {
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [gsc, setGsc] = useState<GscState>({ status: 'loading' });

  const [sitePick, setSitePick] = useState<{ projectId: string; site: string } | null>(null);
  const selectedSite = sitePick && sitePick.projectId === projectId ? sitePick.site : null;
  const fetchKey = googleStatus?.gsc.connected ? `${projectId}:${selectedSite ?? 'auto'}` : null;
  const [fetchedKey, setFetchedKey] = useState<string | null>(null);
  if (fetchedKey !== fetchKey) {
    setFetchedKey(fetchKey);
    setGsc({ status: 'loading' });
  }

  useEffect(() => {
    let cancelled = false;

    getGoogleStatus(accessToken, clientId)
      .then((status) => {
        if (!cancelled) setGoogleStatus(status);
      })
      .catch((err) => {
        if (!cancelled) setStatusError(err instanceof Error ? err.message : 'Failed to load Google status');
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId]);

  useEffect(() => {
    if (!fetchKey) return;
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
  }, [accessToken, clientId, fetchKey, projectId, selectedSite]);

  if (statusError) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-destructive">{statusError}</p>
        </CardContent>
      </Card>
    );
  }

  if (!googleStatus) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!googleStatus.gsc.connected) {
    return <ConnectGoogle accessToken={accessToken} clientId={clientId} canEdit={false} showAnalytics={!googleStatus.ga.connected} />;
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Organic</h1>
        <p className="text-sm text-muted-foreground">{projectName} · Google Search Console</p>
      </div>
      {gsc.status === 'loading' ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Loading search performance…</p>
          </CardContent>
        </Card>
      ) : null}
      {gsc.status === 'error' && gsc.noSite ? (
        <SitePicker
          accessToken={accessToken}
          clientId={clientId}
          projectId={projectId}
          onPick={(site) => setSitePick({ projectId, site })}
        />
      ) : null}
      {gsc.status === 'error' && gsc.scopeMissing ? (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-6">
            <p className="text-sm">
              Search Console access was revoked or never fully granted — Google is refusing with
              insufficient scope.
            </p>
            <p className="text-sm text-muted-foreground">
              Only the account&apos;s POC can reconnect. Preview is read-only.
            </p>
          </CardContent>
        </Card>
      ) : null}
      {gsc.status === 'error' && !gsc.noSite && !gsc.scopeMissing ? (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-6">
            <p className="text-sm text-destructive">{gsc.message}</p>
            <p className="text-sm text-muted-foreground">
              If this account has no property for {projectDomain}, connect an account that does.
            </p>
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
        projectId={projectId}
        connected={googleStatus.ga.connected}
        canEdit={false}
      />
    </div>
  );
}
