'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getAnalytics, listGaProperties, startGoogleConnect } from '@/lib/google-api';
import type { GaOverview } from '@/types/google';
import { AreaChart, DeltaArrow } from './OrganicChart';
import { PropertyPicker } from './PropertyPicker';

function GaPropertyPicker({
  accessToken,
  clientId,
  projectId,
  onPick,
}: {
  accessToken: string;
  clientId: string;
  projectId: string;
  onPick: (propertyId: string) => void;
}) {
  const [properties, setProperties] = useState<Array<{ id: string; name: string }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    listGaProperties(accessToken, clientId, projectId)
      .then((list) => {
        if (!cancelled) setProperties(list);
      })
      .catch(() => {
        if (!cancelled) setProperties([]);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, projectId]);

  return (
    <PropertyPicker
      title="Choose an Analytics property"
      description="This account has no property matching the project domain — pick one to view its data."
      items={(properties ?? []).map((p) => ({ key: p.id, label: p.name, hint: p.id }))}
      onPick={onPick}
      isLoading={properties === null}
    />
  );
}

/** Analytics section: connected → tiles + chart; otherwise the connect card (POC-only button). */
export function GaSection({
  accessToken,
  clientId,
  projectId,
  connected,
  canEdit,
}: {
  accessToken: string;
  clientId: string;
  projectId: string;
  connected: boolean;
  canEdit: boolean;
}) {
  const [overview, setOverview] = useState<GaOverview | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [propertyPick, setPropertyPick] = useState<{ projectId: string; propertyId: string } | null>(null);
  const selectedProperty =
    propertyPick && propertyPick.projectId === projectId ? propertyPick.propertyId : null;

  // A new project, grant, or manual pick resets the fetch (handled during
  // render, not in an effect, so no stale fetch can win).
  const fetchKey = connected ? `${projectId}:${selectedProperty ?? 'auto'}` : null;
  const [fetchedKey, setFetchedKey] = useState<string | null>(null);
  if (fetchedKey !== fetchKey) {
    setFetchedKey(fetchKey);
    setOverview(null);
    setFailure(null);
  }

  useEffect(() => {
    if (!connected || !fetchKey) return;
    let cancelled = false;

    getAnalytics(accessToken, clientId, projectId, selectedProperty ?? undefined)
      .then((data) => {
        if (!cancelled) setOverview(data);
      })
      .catch((err) => {
        if (!cancelled) setFailure(err instanceof Error ? err.message : 'Failed to load Analytics');
      });

    return () => {
      cancelled = true;
    };
  }, [connected, accessToken, clientId, projectId, selectedProperty, fetchKey]);

  async function connect() {
    setError(null);
    setPending(true);
    try {
      await startGoogleConnect(accessToken, clientId, 'ga');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setPending(false);
    }
  }

  if (!connected || (failure && !failure.includes('google-no-property'))) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Google Analytics</CardTitle>
          <CardDescription>
            {failure
              ? 'Analytics is linked but its data could not be read — reconnecting usually fixes it.'
              : 'Sessions and users — optional, adds on once connected.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div>
            <Button variant="secondary" onClick={connect} disabled={!canEdit || pending}>
              {pending ? 'Redirecting…' : failure ? 'Reconnect Analytics' : 'Connect Analytics'}
            </Button>
          </div>
          {!canEdit ? (
            <p className="text-sm text-muted-foreground">Only your account&apos;s POC can connect Google accounts.</p>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    );
  }

  if (failure) {
    return (
      <GaPropertyPicker
        accessToken={accessToken}
        clientId={clientId}
        projectId={projectId}
        onPick={(propertyId) => {
          setFailure(null);
          setPropertyPick({ projectId, propertyId });
        }}
      />
    );
  }

  if (!overview) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Loading Analytics…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Sessions</p>
            <p className="text-3xl font-semibold">{overview.totals.sessions.toLocaleString()}</p>
            <div className="text-xs">
              <DeltaArrow current={overview.totals.sessions} previous={overview.previousTotals.sessions} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Active users</p>
            <p className="text-3xl font-semibold">{overview.totals.activeUsers.toLocaleString()}</p>
            <div className="text-xs">
              <DeltaArrow current={overview.totals.activeUsers} previous={overview.previousTotals.activeUsers} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Pageviews</p>
            <p className="text-3xl font-semibold">{overview.totals.screenPageViews.toLocaleString()}</p>
            <div className="text-xs">
              <DeltaArrow current={overview.totals.screenPageViews} previous={overview.previousTotals.screenPageViews} />
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sessions over time</CardTitle>
          <CardDescription>Last {overview.days} days</CardDescription>
        </CardHeader>
        <CardContent>
          <AreaChart
            values={overview.byDate.map((d) => d.sessions)}
            labels={overview.byDate.map((d) => d.date)}
            ariaLabel="Daily sessions"
          />
        </CardContent>
      </Card>
    </div>
  );
}
