'use client';

import { useCallback, useEffect, useState } from 'react';
import { UsersRound } from '@/components/animate-ui/icons/users-round';
import { InlineEmpty, Section } from '@/components/portal/blocks';
import { Button } from '@/components/portal/button';
import { PageHeader, PortalPage, StatusChip } from '@/components/portal/layout';
import { PortalLoading } from '@/components/portal/states';
import type { Tone } from '@/components/portal/tone';
import { InviteMemberDialog } from '@/components/team/invite-member-dialog';
import { disableMember, enableMember, listMembers, resendInvite } from '@/lib/team-api';
import type { SessionUser } from '@/types/auth';
import type { TeamMember, TeamMembers } from '@/types/team';

const STATUS_TONE: Record<TeamMember['status'], Tone> = {
  ACTIVE: 'good',
  INVITED: 'watch',
  DISABLED: 'bad',
};

const STATUS_WORD: Record<TeamMember['status'], string> = {
  ACTIVE: 'Active',
  INVITED: 'Invited',
  DISABLED: 'Disabled',
};

/**
 * Team management inside the client workspace.
 *
 * Rendered at `/client/projects/[id]/team`, so it sits in the same shell as
 * every other workspace tab and the sidebar stays put. It used to live only at
 * `/team`, a standalone page outside that shell: clicking it dropped the
 * client out of the app, and a non-POC member was bounced to `/dashboard`.
 *
 * Seats belong to the client account, not the project, so the list is the
 * same from every project. The POC can invite, resend, enable and disable;
 * other members see the list read-only (the backend enforces the same rule).
 */
export function TeamManagement({ user, accessToken }: { user: SessionUser; accessToken: string }) {
  const [team, setTeam] = useState<TeamMembers | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const isPoc = user.role === 'CLIENT_POC';

  const refresh = useCallback(async () => {
    try {
      setLoadError(null);
      setTeam(await listMembers(accessToken));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load your team');
    }
  }, [accessToken]);

  useEffect(() => {
    let cancelled = false;
    listMembers(accessToken)
      .then((data) => {
        if (!cancelled) setTeam(data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load your team');
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  async function handleAction(member: TeamMember, action: 'resend' | 'toggle') {
    setPendingId(member.id);
    setActionError(null);
    try {
      if (action === 'resend') await resendInvite(accessToken, member.id);
      else if (member.status === 'DISABLED') await enableMember(accessToken, member.id);
      else await disableMember(accessToken, member.id);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setPendingId(null);
    }
  }

  if (!team && !loadError) return <PortalLoading label="Loading your team" />;

  const atSeatLimit = team ? team.seatsUsed >= team.seatLimit : false;

  return (
    <PortalPage>
      <PageHeader
        eyebrow="System"
        title="Team management"
        meta={team ? <span>{team.seatsUsed} of {team.seatLimit} seats used</span> : undefined}
        summary={
          isPoc
            ? 'Invite colleagues to your workspace and manage who can sign in. Seats cover your whole account, not just this project.'
            : 'Everyone who can sign in to your workspace. Your account contact manages invitations and access.'
        }
        actions={isPoc && team && !atSeatLimit ? <InviteMemberDialog accessToken={accessToken} onInvited={refresh} /> : undefined}
      />

      {loadError ? (
        <Section icon={UsersRound} eyebrow="Members">
          <div className="flex flex-col items-start gap-3">
            <InlineEmpty>We couldn&apos;t load your team: {loadError}</InlineEmpty>
            <Button variant="secondary" size="sm" onClick={() => void refresh()}>
              Try again
            </Button>
          </div>
        </Section>
      ) : team ? (
        <Section
          icon={UsersRound}
          eyebrow="Members"
          right={<span className="text-sm text-muted-foreground">{team.members.length} people</span>}
          description={
            isPoc && atSeatLimit
              ? "You've used all your seats. Ask your Rothenhall lead to raise the seat limit to invite more people."
              : undefined
          }
          flush
        >
          {actionError ? (
            <p role="alert" className="border-t border-border px-5 py-2.5 text-sm text-[var(--danger)]">
              {actionError}
            </p>
          ) : null}
          <ul className="flex flex-col pb-2">
            {team.members.map((member) => {
              const isSelf = member.id === user.id;
              return (
                <li key={member.id} className="flex items-center gap-3 border-t border-border px-5 py-3 text-sm">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{member.email}</span>
                    <span className="text-xs text-muted-foreground">
                      {member.role === 'CLIENT_POC' ? 'Account contact' : 'Member'}
                      {isSelf ? ' · You' : ''}
                    </span>
                  </div>
                  <StatusChip tone={STATUS_TONE[member.status]}>{STATUS_WORD[member.status]}</StatusChip>
                  {isPoc && !isSelf ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pendingId === member.id}
                      onClick={() => void handleAction(member, member.status === 'INVITED' ? 'resend' : 'toggle')}
                    >
                      {member.status === 'INVITED' ? 'Resend' : member.status === 'DISABLED' ? 'Enable' : 'Disable'}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}
    </PortalPage>
  );
}
