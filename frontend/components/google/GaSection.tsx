'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getAnalytics, startGoogleConnect } from '@/lib/google-api';
import type { GaOverview } from '@/types/google';
import { AreaChart, DeltaArrow } from './OrganicChart';

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
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;

    getAnalytics(accessToken, clientId, projectId)
      .then((data) => {
        if (!cancelled) setOverview(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [connected, accessToken, clientId, projectId]);

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

  if (!connected || failed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Google Analytics</CardTitle>
          <CardDescription>
            {failed
              ? 'Analytics is linked but its data could not be read — reconnecting usually fixes it.'
              : 'Sessions and users — optional, adds on once connected.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div>
            <Button variant="secondary" onClick={connect} disabled={!canEdit || pending}>
              {pending ? 'Redirecting…' : failed ? 'Reconnect Analytics' : 'Connect Analytics'}
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
