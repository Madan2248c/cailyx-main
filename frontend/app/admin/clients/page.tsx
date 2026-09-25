'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CreateClientDialog } from '@/components/admin/create-client-dialog';
import { EditSeatsDialog } from '@/components/admin/edit-seats-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { activateClient, listClients, suspendClient } from '@/lib/team-api';
import type { ClientSummary } from '@/types/team';

export default function AdminClientsPage() {
  const { user, accessToken, isLoading } = useAuth();
  const router = useRouter();
  const [clients, setClients] = useState<ClientSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    try {
      setClients(await listClients(accessToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clients');
    }
  }, [accessToken]);

  useEffect(() => {
    if (!isLoading && (!user || user.role !== 'ADMIN')) {
      router.replace('/dashboard');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    listClients(accessToken)
      .then((data) => {
        if (!cancelled) setClients(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load clients');
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  async function handleToggle(client: ClientSummary) {
    if (!accessToken) return;
    setPendingId(client.id);
    setError(null);
    try {
      if (client.status === 'ACTIVE') {
        await suspendClient(accessToken, client.id);
      } else {
        await activateClient(accessToken, client.id);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setPendingId(null);
    }
  }

  if (isLoading || !user || user.role !== 'ADMIN') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Clients</h1>
        {accessToken ? <CreateClientDialog accessToken={accessToken} onCreated={refresh} /> : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {clients === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : clients.length === 0 ? (
        <p className="text-sm text-muted-foreground">No clients yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {clients.map((client) => (
            <Card key={client.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{client.name}</CardTitle>
                  <Badge variant={client.status === 'ACTIVE' ? 'default' : 'destructive'}>
                    {client.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
                <span>
                  POC:{' '}
                  {client.poc ? `${client.poc.email} (${client.poc.status})` : 'None invited yet'}
                </span>
                <div className="flex items-center justify-between">
                  <span>
                    Seats: {client.seatsUsed} / {client.seatLimit}
                  </span>
                  <div className="flex items-center gap-2">
                    {accessToken ? (
                      <EditSeatsDialog accessToken={accessToken} client={client} onUpdated={refresh} />
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pendingId === client.id}
                      onClick={() => handleToggle(client)}
                    >
                      {client.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
