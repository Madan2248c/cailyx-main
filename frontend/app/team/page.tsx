'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InviteMemberDialog } from '@/components/team/invite-member-dialog';
import { useAuth } from '@/contexts/auth-context';
import { disableMember, enableMember, listMembers, resendInvite } from '@/lib/team-api';
import type { TeamMember, TeamMembers } from '@/types/team';

const STATUS_VARIANT: Record<TeamMember['status'], 'default' | 'secondary' | 'destructive'> = {
  ACTIVE: 'default',
  INVITED: 'secondary',
  DISABLED: 'destructive',
};

export default function TeamPage() {
  const { user, accessToken, isLoading } = useAuth();
  const router = useRouter();
  const [team, setTeam] = useState<TeamMembers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    try {
      setTeam(await listMembers(accessToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load team');
    }
  }, [accessToken]);

  useEffect(() => {
    if (!isLoading && (!user || user.role !== 'CLIENT_POC')) {
      router.replace('/dashboard');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    listMembers(accessToken)
      .then((data) => {
        if (!cancelled) setTeam(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load team');
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  async function handleAction(member: TeamMember, action: 'resend' | 'toggle') {
    if (!accessToken) return;
    setPendingId(member.id);
    setError(null);
    try {
      if (action === 'resend') {
        await resendInvite(accessToken, member.id);
      } else if (member.status === 'DISABLED') {
        await enableMember(accessToken, member.id);
      } else {
        await disableMember(accessToken, member.id);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setPendingId(null);
    }
  }

  if (isLoading || !user || user.role !== 'CLIENT_POC') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const atSeatLimit = team ? team.seatsUsed >= team.seatLimit : false;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Your team</h1>
        {accessToken && !atSeatLimit ? (
          <InviteMemberDialog accessToken={accessToken} onInvited={refresh} />
        ) : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {team === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Members</CardTitle>
              <span className="text-sm text-muted-foreground">
                {team.seatsUsed} / {team.seatLimit} seats used
              </span>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {atSeatLimit ? (
              <p className="text-sm text-muted-foreground">
                You&apos;ve used all your available seats. Ask an admin to increase your seat limit
                to invite more people.
              </p>
            ) : null}
            {team.members.map((member) => {
              const isSelf = member.id === user.id;
              return (
                <div
                  key={member.id}
                  className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0"
                >
                  <div className="flex flex-col">
                    <span className="text-sm">{member.email}</span>
                    <span className="text-xs text-muted-foreground">
                      {member.role === 'CLIENT_POC' ? 'POC' : 'Member'}
                      {isSelf ? ' · You' : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={STATUS_VARIANT[member.status]}>{member.status}</Badge>
                    {!isSelf && member.status === 'INVITED' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pendingId === member.id}
                        onClick={() => handleAction(member, 'resend')}
                      >
                        Resend
                      </Button>
                    ) : null}
                    {!isSelf && member.status !== 'INVITED' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pendingId === member.id}
                        onClick={() => handleAction(member, 'toggle')}
                      >
                        {member.status === 'DISABLED' ? 'Enable' : 'Disable'}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
