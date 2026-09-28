'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getCompetitorsGap, listCompetitorProfiles } from '@/lib/competitors-api';
import { RankMovement } from '@/components/competitors/RankMovement';
import { addCompetitor, patchCompetitor } from '@/lib/onboarding-api';
import type {
  CompetitorWithProfile,
  GapResponse,
  GapRow,
  ReviewRating,
} from '@/types/competitor';
import { PortalLoading } from '@/components/portal/states';

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function asReviewRating(raw: unknown): ReviewRating | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as { rating?: unknown; source?: unknown; count?: unknown };
  if (typeof r.rating !== 'number' || !Number.isFinite(r.rating)) return null;
  return {
    source: typeof r.source === 'string' ? r.source : 'reviews',
    rating: r.rating,
    count: typeof r.count === 'number' && Number.isFinite(r.count) ? r.count : null,
  };
}

function seoScoreOf(row: GapRow): number | null {
  const score = row.profile?.seoScore;
  return typeof score === 'number' && Number.isFinite(score) ? score : null;
}

function scoreTone(score: number | null): { text: string; bar: string } {
  if (score === null) return { text: 'text-muted-foreground', bar: 'bg-border' };
  if (score >= 80) return { text: 'text-success', bar: 'bg-success' };
  if (score >= 50) return { text: 'text-warning', bar: 'bg-warning' };
  return { text: 'text-danger', bar: 'bg-danger' };
}

function formatRating(rating: ReviewRating | null): string {
  if (!rating) return '—';
  const count = rating.count !== null ? ` (${rating.count})` : '';
  return `${rating.rating.toFixed(1)} / 5${count}`;
}

/**
 * timesAhead = the client was ranked ahead of this rival; timesBehind = the
 * client lost to them. From the client's chair, "behind" is the bad outcome.
 */
function aeoTone(standing: GapRow['aeoStanding']): 'ahead' | 'behind' | 'tied' | 'none' {
  if (!standing) return 'none';
  if (standing.timesBehind > standing.timesAhead) return 'behind';
  if (standing.timesAhead > standing.timesBehind) return 'ahead';
  if (standing.timesAhead > 0 || standing.coMentions > 0) return 'tied';
  return 'none';
}

export function CompetitorsTab({
  accessToken,
  clientId,
  projectId,
  projectName,
  canEdit,
}: {
  accessToken: string;
  clientId: string;
  projectId: string;
  projectName: string;
  canEdit: boolean;
}) {
  const [gap, setGap] = useState<GapResponse | null>(null);
  const [rivals, setRivals] = useState<CompetitorWithProfile[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      getCompetitorsGap(accessToken, clientId, projectId),
      listCompetitorProfiles(accessToken, clientId, projectId),
    ])
      .then(([gapResult, rivalList]) => {
        if (!cancelled) {
          setGap(gapResult);
          setRivals(rivalList);
          setState('ready');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load competitors');
          setState('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, projectId]);

  function refreshGap() {
    getCompetitorsGap(accessToken, clientId, projectId)
      .then((result) => setGap(result))
      .catch((err) => setActionError(err instanceof Error ? err.message : 'Failed to refresh the comparison'));
  }

  async function handleToggle(id: string, tracked: boolean) {
    if (!canEdit) return;
    setActionError(null);
    setMutatingId(id);
    try {
      const updated = await patchCompetitor(accessToken, clientId, projectId, id, {
        status: tracked ? 'tracked' : 'candidate',
      });
      setRivals((prev) =>
        prev
          ? prev.map((r) =>
              r.id === updated.id
                ? { ...r, name: updated.name, domain: updated.domain, status: updated.status }
                : r,
            )
          : prev,
      );
      refreshGap();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setMutatingId(null);
    }
  }

  async function handleAdd() {
    const name = newName.trim();
    if (!canEdit || name === '') return;
    setActionError(null);
    setIsAdding(true);
    try {
      const created = await addCompetitor(accessToken, clientId, projectId, {
        name,
        ...(newDomain.trim() === '' ? {} : { domain: newDomain.trim() }),
      });
      setRivals((prev) => (prev ? [...prev, { ...created, projectId, latestProfile: null }] : prev));
      setNewName('');
      setNewDomain('');
      refreshGap();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsAdding(false);
    }
  }

  if (state === 'loading') {
    return <PortalLoading label="Loading competitors" />;
  }

  if (state === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!gap || !rivals) return null;

  const tracked = gap.competitors;
  const ownScore = seoScoreOf(gap.own);
  const scored = [gap.own, ...tracked]
    .map((row) => ({ row, score: seoScoreOf(row) }))
    .filter((s): s is { row: GapRow; score: number } => s.score !== null)
    .sort((a, b) => b.score - a.score);
  const ownRank = scored.findIndex((s) => s.row.competitorId === null) + 1;
  const rivalsAheadSeo = tracked.filter((r) => {
    const s = seoScoreOf(r);
    return s !== null && ownScore !== null && s > ownScore;
  });
  const bestRivalSeo = [...tracked].sort((a, b) => (seoScoreOf(b) ?? -1) - (seoScoreOf(a) ?? -1))[0];
  const bestRivalScore = bestRivalSeo ? seoScoreOf(bestRivalSeo) : null;

  const ownSchemas = new Set(asStringArray(gap.own.profile?.schemaTypes));
  const missingCounts = new Map<string, number>();
  for (const rival of tracked) {
    for (const schema of asStringArray(rival.profile?.schemaTypes)) {
      if (!ownSchemas.has(schema)) missingCounts.set(schema, (missingCounts.get(schema) ?? 0) + 1);
    }
  }
  const topMissingSchemas = [...missingCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([schema]) => schema);

  const ownRating = asReviewRating(gap.own.profile?.reviewRating);
  const bestRivalRating = tracked
    .map((r) => ({ row: r, rating: asReviewRating(r.profile?.reviewRating) }))
    .filter((s): s is { row: GapRow; rating: ReviewRating } => s.rating !== null)
    .sort((a, b) => b.rating.rating - a.rating.rating)[0];

  const rivalsBeatingYou = tracked.filter((r) => aeoTone(r.aeoStanding) === 'behind');
  const rivalsYouBeat = tracked.filter((r) => aeoTone(r.aeoStanding) === 'ahead');
  const hasAeoSignal = tracked.some((r) => r.aeoStanding !== null);
  const unprofiled = tracked.filter((r) => !r.profile || r.profile.fetchStatus !== 'OK');

  const actions: string[] = [];
  if (rivalsAheadSeo.length > 0 && bestRivalSeo && bestRivalScore !== null) {
    actions.push(
      `${rivalsAheadSeo.length} ${rivalsAheadSeo.length === 1 ? 'rival scores' : 'rivals score'} higher on homepage SEO — ${bestRivalSeo.name} leads at ${bestRivalScore}. Work through the homepage issues in the table below.`,
    );
  }
  if (topMissingSchemas.length > 0) {
    actions.push(
      `Rivals use structured data you don't (${topMissingSchemas.join(', ')}). Adding matching schema helps search and AI engines understand your pages.`,
    );
  }
  if (bestRivalRating && (!ownRating || bestRivalRating.rating.rating > ownRating.rating)) {
    actions.push(
      `${bestRivalRating.row.name} shows ${formatRating(bestRivalRating.rating)}${ownRating ? ` vs your ${formatRating(ownRating)}` : ' and you show no rating'} — reviews feed the comparison boxes buyers and AI answers quote.`,
    );
  }
  if (rivalsBeatingYou.length > 0) {
    const worst = [...rivalsBeatingYou].sort(
      (a, b) => (b.aeoStanding?.timesBehind ?? 0) - (a.aeoStanding?.timesBehind ?? 0),
    )[0];
    actions.push(
      `AI answers recommend ${worst.name} over you ${worst.aeoStanding?.timesBehind ?? 0} ${worst.aeoStanding?.timesBehind === 1 ? 'time' : 'times'} — open AI visibility to see the exact prompts.`,
    );
  }
  if (unprofiled.length > 0) {
    actions.push(
      `${unprofiled.length} ${unprofiled.length === 1 ? 'rival has' : 'rivals have'} no usable profile yet (added manually or the fetch failed) — check ${unprofiled.length === 1 ? 'its' : 'their'} domain below.`,
    );
  }
  if (actions.length === 0 && tracked.length > 0) {
    actions.push('You lead on every counted signal against your tracked rivals — keep it that way by tracking new rivals as they appear.');
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Competitors</h1>
        <p className="text-sm text-muted-foreground">
          {projectName}
          {tracked.length > 0 ? ` · you vs ${tracked.length} tracked ${tracked.length === 1 ? 'rival' : 'rivals'}` : ''}
        </p>
      </div>

      {!canEdit ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          You&apos;re viewing as a team member — only your account&apos;s POC can save changes.
        </p>
      ) : null}

      {tracked.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              No tracked rivals yet. Confirm the ones that matter below — the head-to-head comparison appears here once you track at least one.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardContent className="flex flex-col gap-1 pt-5">
                <p className="text-xs font-medium text-muted-foreground">Homepage SEO rank</p>
                <p className="text-4xl font-semibold">
                  {ownRank > 0 ? `#${ownRank}` : '—'}
                  <span className="text-base font-normal text-muted-foreground"> of {scored.length}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {ownScore !== null ? `your score ${ownScore}` : 'your homepage has no score yet'}
                  {bestRivalScore !== null && ownScore !== null && bestRivalScore > ownScore
                    ? ` · best rival ${bestRivalScore}`
                    : ''}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex flex-col gap-1 pt-5">
                <p className="text-xs font-medium text-muted-foreground">AI answers vs rivals</p>
                <p className="text-4xl font-semibold">
                  {hasAeoSignal ? (
                    <>
                      <span className="text-success">{rivalsYouBeat.length}</span>
                      <span className="text-base font-normal text-muted-foreground"> ahead · </span>
                      <span className="text-danger">{rivalsBeatingYou.length}</span>
                      <span className="text-base font-normal text-muted-foreground"> behind</span>
                    </>
                  ) : (
                    '—'
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {hasAeoSignal ? 'ranked answers where you and a rival both appear' : 'no ranked co-mentions in the latest audit'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex flex-col gap-1 pt-5">
                <p className="text-xs font-medium text-muted-foreground">Structured data</p>
                <p className="text-4xl font-semibold">
                  {ownSchemas.size}
                  <span className="text-base font-normal text-muted-foreground"> types</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {topMissingSchemas.length > 0
                    ? `rivals use ${topMissingSchemas.join(', ')}`
                    : 'you match every rival schema type'}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">What to do next</CardTitle>
              <CardDescription>Counted gaps only — no guesswork</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              {actions.map((action) => (
                <p key={action.slice(0, 48)} className="text-sm">
                  {action}
                </p>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Head-to-head</CardTitle>
              <CardDescription>You vs each tracked rival</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col overflow-x-auto p-0">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-6 py-2.5 font-medium">Rival</th>
                    <th className="px-4 py-2.5 font-medium">SEO</th>
                    <th className="px-4 py-2.5 font-medium">Schema</th>
                    <th className="px-4 py-2.5 font-medium">Reviews</th>
                    <th className="px-6 py-2.5 font-medium">AI answers</th>
                  </tr>
                </thead>
                <tbody>
                  <HeadToHeadRow row={gap.own} isOwn />
                  {tracked.map((row) => (
                    <HeadToHeadRow key={row.competitorId ?? row.name} row={row} />
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      <RankMovement accessToken={accessToken} clientId={clientId} projectId={projectId} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tracked rivals</CardTitle>
          <CardDescription>Confirm the ones that matter, untrack the ones that don&apos;t</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {rivals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No competitors on file yet — add the first one below.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {rivals.map((rival) => {
                const trackedNow = rival.status === 'tracked';
                return (
                  <li key={rival.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <input
                      type="checkbox"
                      id={`track-${rival.id}`}
                      className="size-4 accent-primary"
                      checked={trackedNow}
                      disabled={!canEdit || mutatingId === rival.id}
                      onChange={(e) => handleToggle(rival.id, e.target.checked)}
                    />
                    <div className="min-w-0 flex-1">
                      <Label htmlFor={`track-${rival.id}`}>{trackedNow ? 'Tracked' : 'Untracked'}</Label>
                      <p className="truncate text-sm font-medium">
                        {rival.name}
                        {rival.domain ? <span className="font-normal text-muted-foreground"> · {rival.domain}</span> : null}
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0 capitalize">
                      {rival.source.replace(/_/g, ' ')}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
          {canEdit ? (
            <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3">
              <Label>Add a missing rival</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
                <Input placeholder="Domain (optional)" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} />
                <Button type="button" variant="secondary" onClick={handleAdd} disabled={newName.trim() === '' || isAdding}>
                  {isAdding ? 'Adding…' : 'Add'}
                </Button>
              </div>
            </div>
          ) : null}
          {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function HeadToHeadRow({ row, isOwn = false }: { row: GapRow; isOwn?: boolean }) {
  const score = seoScoreOf(row);
  const tone = scoreTone(score);
  const schemas = asStringArray(row.profile?.schemaTypes);
  const rating = asReviewRating(row.profile?.reviewRating);
  const standing = row.aeoStanding;
  const standingTone = aeoTone(standing);
  const profiled = row.profile && row.profile.fetchStatus === 'OK';

  return (
    <tr className={`border-t border-border align-top ${isOwn ? 'bg-muted/40' : ''}`}>
      <td className="px-6 py-3">
        <div className="flex items-center gap-2">
          <p className="font-medium">{row.name}</p>
          {isOwn ? <Badge variant="secondary">You</Badge> : null}
        </div>
        <p className="text-xs text-muted-foreground">{row.domain ?? 'no domain on file'}</p>
        {!profiled && !isOwn ? (
          <p className="mt-0.5 text-xs text-muted-foreground">Not profiled yet — check the domain.</p>
        ) : null}
        {!profiled && isOwn ? (
          <p className="mt-0.5 text-xs text-muted-foreground">Your homepage has no profile yet.</p>
        ) : null}
      </td>
      <td className="px-4 py-3">
        {score === null ? (
          <p className="text-muted-foreground">—</p>
        ) : (
          <div className="flex min-w-28 flex-col gap-1">
            <p className={`font-semibold ${tone.text}`}>{score}</p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${score}%` }} />
            </div>
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        {schemas.length === 0 ? (
          <p className="text-muted-foreground">—</p>
        ) : (
          <p>
            <span className="font-medium">{schemas.length}</span>{' '}
            <span className="text-muted-foreground">{schemas.slice(0, 3).join(', ')}{schemas.length > 3 ? ` +${schemas.length - 3}` : ''}</span>
          </p>
        )}
      </td>
      <td className="px-4 py-3">
        <p className={rating ? '' : 'text-muted-foreground'}>{formatRating(rating)}</p>
      </td>
      <td className="px-6 py-3">
        {isOwn || standingTone === 'none' ? (
          <p className="text-muted-foreground">{isOwn ? '—' : 'No AEO data'}</p>
        ) : (
          <p>
            <span className={standingTone === 'behind' ? 'font-medium text-danger' : 'font-medium text-success'}>
              {standingTone === 'behind' ? 'Behind' : standingTone === 'ahead' ? 'Ahead' : 'Tied'}
            </span>{' '}
            <span className="text-muted-foreground">
              {standing?.timesAhead} ahead · {standing?.timesBehind} behind
              {(standing?.coMentions ?? 0) > 0 ? ` · ${standing?.coMentions} tied` : ''}
            </span>
          </p>
        )}
      </td>
    </tr>
  );
}
