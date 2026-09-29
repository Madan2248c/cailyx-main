'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { ConfirmDialog, Monogram, Notice, SearchField, Segmented } from '@/components/admin/admin-ui';
import { CreateClientDialog } from '@/components/admin/create-client-dialog';
import { EditSeatsDialog } from '@/components/admin/edit-seats-dialog';
import { useLoad } from '@/components/admin/use-load';
import { Button } from '@/components/portal/button';
import { Section } from '@/components/portal/blocks';
import { Meter } from '@/components/portal/charts';
import { PageHeader, PortalPage, StatusChip } from '@/components/portal/layout';
import { EmptyState, PortalLoading } from '@/components/portal/states';
import { formatDate, plural } from '@/components/portal/tone';
import type { Tone } from '@/components/portal/tone';
import { useAuth } from '@/contexts/auth-context';
import { activateClient, listClients, suspendClient } from '@/lib/team-api';
import type { UserStatus } from '@/types/auth';
import type { ClientSummary } from '@/types/team';

type Filter = 'ALL' | 'ACTIVE' | 'SUSPENDED';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SUSPENDED', label: 'Suspended' },
];

const POC_STATE: Record<UserStatus, { tone: Tone; word: string }> = {
  ACTIVE: { tone: 'good', word: 'Signed in' },
  INVITED: { tone: 'watch', word: 'Invite pending' },
  DISABLED: { tone: 'bad', word: 'Disabled' },
};

function seatTone(used: number, limit: number): Tone {
  if (limit <= 0) return 'neutral';
  if (used >= limit) return 'watch';
  return 'neutral';
}

export default function AdminClientsPage() {
  const { accessToken } = useAuth();
  const load = useCallback(() => listClients(accessToken ?? ''), [accessToken]);
  const { data: clients, error: loadError, loading, reload } = useLoad(accessToken ? load : null, 'Failed to load clients');
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? loadError;
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [toSuspend, setToSuspend] = useState<ClientSummary | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');

  async function activate(client: ClientSummary) {
    if (!accessToken) return;
    setPendingId(client.id);
    setActionError(null);
    setNotice(null);
    try {
      await activateClient(accessToken, client.id);
      await reload();
      setNotice(`${client.name} is active again.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setPendingId(null);
    }
  }

  async function suspend(client: ClientSummary) {
    if (!accessToken) return;
    setPendingId(client.id);
    setActionError(null);
    setNotice(null);
    try {
      await suspendClient(accessToken, client.id);
      await reload();
      setNotice(`${client.name} is suspended.`);
    } finally {
      setPendingId(null);
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (clients ?? []).filter((c) => {
      if (filter !== 'ALL' && c.status !== filter) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || (c.poc?.email.toLowerCase().includes(q) ?? false);
    });
  }, [clients, query, filter]);

  if (clients === null && loading) return <PortalLoading label="Loading clients" />;

  const total = clients?.length ?? 0;
  const suspendedCount = (clients ?? []).filter((c) => c.status === 'SUSPENDED').length;

  return (
    <PortalPage>
      <PageHeader
        eyebrow="Admin console"
        title="Clients"
        summary={
          total === 0
            ? 'No clients yet. Create the first one to send their point of contact an invite.'
            : `${plural(total, 'client')}${suspendedCount > 0 ? `, ${suspendedCount} suspended` : ''}. Open one to manage its projects and schedules.`
        }
        actions={accessToken ? <CreateClientDialog accessToken={accessToken} onCreated={reload} /> : null}
      />

      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? (
        <Notice tone="ok" onDismiss={() => setNotice(null)}>
          {notice}
        </Notice>
      ) : null}

      {clients !== null && total === 0 ? (
        <Section eyebrow="Clients">
          <EmptyState
            title="No clients yet"
            body="A client is the company you work for. Create one and its point of contact gets an invite to set a password and onboard."
          />
        </Section>
      ) : null}

      {total > 0 ? (
        <Section
          eyebrow="All clients"
          title={visible.length === total ? undefined : `${visible.length} of ${total} shown`}
          flush
          right={
            <div className="flex flex-wrap items-center gap-2">
              <SearchField value={query} onChange={setQuery} label="Search clients" placeholder="Search clients" className="w-48" />
              <Segmented label="Filter by status" value={filter} options={FILTERS} onChange={setFilter} />
            </div>
          }
        >
          {visible.length === 0 ? (
            <p className="px-5 pb-6 text-sm text-muted-foreground">No client matches that search.</p>
          ) : (
            <ul className="flex flex-col pb-1">
              {visible.map((client) => {
                const suspended = client.status === 'SUSPENDED';
                const poc = client.poc ? POC_STATE[client.poc.status] : null;
                const busy = pendingId === client.id;
                return (
                  <li key={client.id} className="border-t border-border first:border-t-0">
                    <div className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:gap-5">
                      <Link
                        href={`/admin/clients/${client.id}`}
                        className="g-row-link -mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        aria-label={`${client.name}, open projects`}
                      >
                        <Monogram name={client.name} className={suspended ? 'opacity-60' : undefined} />
                        <span className="flex min-w-0 flex-col">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-semibold">{client.name}</span>
                            <StatusChip tone={suspended ? 'bad' : 'good'}>{suspended ? 'Suspended' : 'Active'}</StatusChip>
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {client.poc ? client.poc.email : 'No point of contact invited yet'}
                            {' · '}added {formatDate(client.createdAt)}
                          </span>
                        </span>
                        <ArrowUpRight aria-hidden className="g-row-arrow ml-auto size-4 shrink-0 opacity-50" />
                      </Link>

                      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 lg:shrink-0">
                        <div className="flex w-28 flex-col gap-1.5">
                          {poc ? <StatusChip tone={poc.tone}>{poc.word}</StatusChip> : <StatusChip tone="neutral">No contact</StatusChip>}
                        </div>
                        <div className="flex w-28 flex-col gap-1.5">
                          <span className="g-num text-xs text-muted-foreground">
                            Seats {client.seatsUsed} / {client.seatLimit}
                          </span>
                          <Meter
                            value={client.seatsUsed}
                            max={Math.max(client.seatLimit, 1)}
                            tone={seatTone(client.seatsUsed, client.seatLimit)}
                            label={`${client.seatsUsed} of ${client.seatLimit} seats used`}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/admin/clients/${client.id}`}>Projects</Link>} />
                          {accessToken ? <EditSeatsDialog accessToken={accessToken} client={client} onUpdated={reload} /> : null}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            aria-busy={busy}
                            onClick={() => (suspended ? void activate(client) : setToSuspend(client))}
                          >
                            {busy ? 'Working…' : suspended ? 'Activate' : 'Suspend'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      ) : null}

      <ConfirmDialog
        open={toSuspend !== null}
        onOpenChange={(open) => {
          if (!open) setToSuspend(null);
        }}
        destructive
        title={`Suspend ${toSuspend?.name ?? 'this client'}?`}
        description="Everyone at this client is locked out of the portal until you activate them again. Their projects and data are kept."
        confirmLabel="Suspend client"
        pendingLabel="Suspending…"
        onConfirm={async () => {
          if (toSuspend) await suspend(toSuspend);
        }}
      />
    </PortalPage>
  );
}
