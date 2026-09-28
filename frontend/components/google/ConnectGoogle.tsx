'use client';

import { useState } from 'react';
import { Button } from '@/components/portal/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { startGoogleConnect } from '@/lib/google-api';

/** The locked state: connect Search Console (unlocks), Analytics (adds on). POC-only buttons. */
export function ConnectGoogle({
  accessToken,
  clientId,
  canEdit,
  showAnalytics,
}: {
  accessToken: string;
  clientId: string;
  canEdit: boolean;
  showAnalytics: boolean;
}) {
  const [pending, setPending] = useState<'gsc' | 'ga' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function connect(provider: 'gsc' | 'ga') {
    setError(null);
    setPending(provider);
    try {
      await startGoogleConnect(accessToken, clientId, provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setPending(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Organic visibility</h1>
        <p className="text-sm text-muted-foreground">
          Connect Google to unlock search performance for this project.
        </p>
      </div>
      {!canEdit ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Only your account&apos;s POC can connect Google accounts.
        </p>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Google Search Console</CardTitle>
          <CardDescription>Clicks, impressions, and rankings — required to unlock this dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => connect('gsc')} disabled={!canEdit || pending !== null}>
            {pending === 'gsc' ? 'Redirecting…' : 'Connect Search Console'}
          </Button>
        </CardContent>
      </Card>
      {showAnalytics ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Google Analytics</CardTitle>
            <CardDescription>Sessions and users — optional, adds on once connected.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="secondary" onClick={() => connect('ga')} disabled={!canEdit || pending !== null}>
              {pending === 'ga' ? 'Redirecting…' : 'Connect Analytics'}
            </Button>
          </CardContent>
        </Card>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
