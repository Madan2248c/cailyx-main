'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/portal/button';
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
import { AutoHeight } from '@/components/animate-ui/primitives/effects/auto-height';
import { InlineEmpty, NextSteps, Section, Stat, StatRow, type NextStep } from '@/components/portal/blocks';
import { Meter } from '@/components/portal/charts';
import { MetaDot, PageHeader, PortalPage, StatusChip, Tile } from '@/components/portal/layout';
import { EmptyState, ErrorState, PortalLoading } from '@/components/portal/states';
import { plural, scoreTone as scoreToneOf, TONE_TEXT } from '@/components/portal/tone';

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

/** Where a rival came from, in plain words. */
const SOURCE_WORD: Record<string, string> = {
  manual: 'Added by you',
  cli: 'Added by Rothenhall',
  serp_discovered: 'Found in Google',
  stance_discovered: 'Found in AI answers',
  llm_generated: 'Suggested',
  trustpilot: 'Found on Trustpilot',
};

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

function formatRating(rating: ReviewRating | null): string {
  if (!rating) return 'None found';
  const count = rating.count !== null ? ` from ${rating.count.toLocaleString()} reviews` : '';
  return `${rating.rating.toFixed(1)}/5${count}`;
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
      // No comparison yet (e.g. nothing tracked) must not hide the rival list.
      getCompetitorsGap(accessToken, clientId, projectId).catch(() => null),
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

  if (state === 'loading') return <PortalLoading label="Loading competitors" />;
  if (state === 'error') return <ErrorState title="We couldn't load your competitors" message={error ?? 'Unknown error'} />;
  if (!rivals) return null;

  const tracked = gap?.competitors ?? [];
  const own = gap?.own ?? null;
  const ownScore = own ? seoScoreOf(own) : null;
  const scored = (own ? [own, ...tracked] : tracked)
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

  const ownSchemas = new Set(asStringArray(own?.profile?.schemaTypes));
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

  const ownRating = asReviewRating(own?.profile?.reviewRating);
  const bestRivalRating = tracked
    .map((r) => ({ row: r, rating: asReviewRating(r.profile?.reviewRating) }))
    .filter((s): s is { row: GapRow; rating: ReviewRating } => s.rating !== null)
    .sort((a, b) => b.rating.rating - a.rating.rating)[0];

  const rivalsBeatingYou = tracked.filter((r) => aeoTone(r.aeoStanding) === 'behind');
  const rivalsYouBeat = tracked.filter((r) => aeoTone(r.aeoStanding) === 'ahead');
  const hasAeoSignal = tracked.some((r) => r.aeoStanding !== null);
  const unprofiled = tracked.filter((r) => !r.profile || r.profile.fetchStatus !== 'OK');

  const steps: NextStep[] = [];
  if (rivalsBeatingYou.length > 0) {
    const worst = [...rivalsBeatingYou].sort(
      (a, b) => (b.aeoStanding?.timesBehind ?? 0) - (a.aeoStanding?.timesBehind ?? 0),
    )[0];
    steps.push({
      tone: 'bad',
      lead: `AI answers pick ${worst.name} over you.`,
      text: `It happened ${plural(worst.aeoStanding?.timesBehind ?? 0, 'time')} in our tests. The AI visibility page shows the exact questions.`,
    });
  }
  if (rivalsAheadSeo.length > 0 && bestRivalSeo && bestRivalScore !== null) {
    steps.push({
      tone: 'watch',
      lead: `${plural(rivalsAheadSeo.length, 'rival scores', 'rivals score')} higher on homepage SEO.`,
      text: `${bestRivalSeo.name} leads with ${bestRivalScore} out of 100. Your Fix Plan lists the homepage fixes that close the gap.`,
    });
  }
  if (topMissingSchemas.length > 0) {
    steps.push({
      tone: 'watch',
      lead: 'Rivals describe their business to search engines in ways you don’t.',
      text: `They use ${topMissingSchemas.join(', ')} structured data. Adding the same helps Google and AI tools understand your pages.`,
    });
  }
  if (bestRivalRating && (!ownRating || bestRivalRating.rating.rating > ownRating.rating)) {
    steps.push({
      tone: 'watch',
      lead: `${bestRivalRating.row.name} has better reviews.`,
      text: `${formatRating(bestRivalRating.rating)}${ownRating ? ` against your ${formatRating(ownRating)}` : ', and we found no rating for you'}. Buyers and AI answers both quote review scores.`,
    });
  }
  if (unprofiled.length > 0) {
    steps.push({
      tone: 'neutral',
      lead: unprofiled.length === 1 ? "We couldn't read one rival's website." : `We couldn't read ${unprofiled.length} rivals' websites.`,
      text: `Check the web address for ${unprofiled.map((r) => r.name).join(', ')} in the list below.`,
    });
  }

  return (
    <PortalPage>
      <PageHeader
        eyebrow="Competitors"
        title="You and your rivals"
        meta={
          <>
            <span>{projectName}</span>
            {tracked.length > 0 ? (
              <>
                <MetaDot />
                <span>{plural(tracked.length, 'rival')} tracked</span>
              </>
            ) : null}
          </>
        }
        summary={
          tracked.length === 0
            ? undefined
            : ownRank > 0
              ? `Your homepage SEO ranks ${ordinal(ownRank)} of ${scored.length} against the rivals you track${hasAeoSignal ? `, and AI answers favour you over ${rivalsYouBeat.length} of them` : ''}.`
              : 'Here is how you compare with the rivals you track.'
        }
      />

      {!canEdit ? (
        <p className="rounded-lg bg-muted/60 px-4 py-2.5 text-sm text-muted-foreground">
          You can view this page. Only your company&apos;s main contact can change which rivals are tracked.
        </p>
      ) : null}

      {tracked.length === 0 ? (
        <Tile index={1}>
          <EmptyState
            title="Choose the rivals to compare against"
            body={
              rivals.length > 0
                ? 'Tick the rivals that matter in the list below. The side-by-side comparison appears here as soon as you track one.'
                : 'Add the companies your buyers compare you with. We then compare your websites, reviews and how often AI answers pick each of you.'
            }
          />
        </Tile>
      ) : (
        <>
          <StatRow>
            <Stat
              index={1}
              label="Homepage SEO"
              value={ownRank > 0 ? ordinal(ownRank) : null}
              unit={ownRank > 0 ? `of ${scored.length}` : undefined}
              tone={ownRank === 1 ? 'good' : 'neutral'}
              caption={
                ownScore !== null
                  ? `You score ${ownScore}/100${bestRivalScore !== null && bestRivalScore > ownScore ? `. The best rival scores ${bestRivalScore}.` : '.'}`
                  : "We haven't scored your homepage yet"
              }
              hint="How well your homepage is set up for search engines, scored out of 100 and ranked against the rivals you track."
            />
            <Stat
              index={2}
              label="AI answers"
              value={hasAeoSignal ? rivalsYouBeat.length : null}
              unit={hasAeoSignal ? `of ${tracked.length} rivals beaten` : undefined}
              tone={hasAeoSignal ? (rivalsBeatingYou.length > rivalsYouBeat.length ? 'bad' : 'good') : 'neutral'}
              caption={
                hasAeoSignal
                  ? rivalsBeatingYou.length > 0
                    ? `${plural(rivalsBeatingYou.length, 'rival is', 'rivals are')} picked over you more often`
                    : 'No rival is picked over you more often'
                  : 'Appears after your next AI visibility check'
              }
              hint="When an AI answer names both you and a rival, which one does it recommend first? Counted across every question we test."
            />
            <Stat
              index={3}
              label="Structured data"
              value={ownSchemas.size}
              unit={ownSchemas.size === 1 ? 'type' : 'types'}
              caption={topMissingSchemas.length > 0 ? `Rivals also use ${topMissingSchemas.join(', ')}` : 'You match every rival'}
              hint="Hidden labels on your pages that tell search engines and AI tools what your business is, what you sell and what people say about you."
            />
          </StatRow>

          <NextSteps index={4} items={steps} allClear="You lead on everything we measure. Keep tracking new rivals as they appear." />

          <Section index={5} eyebrow="Side by side" description="You first, then each rival you track." flush>
            <div className="overflow-x-auto">
              <table className="g-table min-w-[680px]">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Homepage SEO</th>
                    <th>Structured data</th>
                    <th>Reviews</th>
                    <th>In AI answers</th>
                  </tr>
                </thead>
                <tbody>
                  {own ? <HeadToHeadRow row={own} isOwn /> : null}
                  {tracked.map((row) => (
                    <HeadToHeadRow key={row.competitorId ?? row.name} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}

      <RankMovement accessToken={accessToken} clientId={clientId} projectId={projectId} />

      <Section
        index={6}
        eyebrow="Rivals you track"
        description={canEdit ? 'Tick the ones that matter. Untick any that aren’t real rivals.' : undefined}
      >
        <AutoHeight deps={[rivals]}>
        {rivals.length === 0 ? (
          canEdit ? null : <InlineEmpty>No rivals yet. Your company&apos;s main contact can add them.</InlineEmpty>
        ) : (
          <ul className="flex flex-col gap-2">
            {rivals.map((rival) => {
              const trackedNow = rival.status === 'tracked';
              return (
                <li key={rival.id}>
                  <label
                    htmlFor={`track-${rival.id}`}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${trackedNow ? 'bg-muted/60' : ''} ${canEdit ? 'cursor-pointer hover:bg-muted' : ''}`}
                  >
                    <input
                      type="checkbox"
                      id={`track-${rival.id}`}
                      className="size-4 accent-primary"
                      checked={trackedNow}
                      disabled={!canEdit || mutatingId === rival.id}
                      onChange={(e) => handleToggle(rival.id, e.target.checked)}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      <span className="font-medium">{rival.name}</span>
                      {rival.domain ? <span className="text-muted-foreground"> · {rival.domain}</span> : null}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{SOURCE_WORD[rival.source] ?? 'Added'}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        </AutoHeight>
        {canEdit ? (
          <form
            className="mt-4 flex flex-col gap-2 border-t border-border pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleAdd();
            }}
          >
            <Label htmlFor="new-rival-name">Add a rival we missed</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input id="new-rival-name" placeholder="Company name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <Input placeholder="Website, e.g. rival.com (optional)" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} />
              <Button type="submit" variant="secondary" disabled={newName.trim() === '' || isAdding}>
                {isAdding ? 'Adding…' : 'Add rival'}
              </Button>
            </div>
          </form>
        ) : null}
        {actionError ? <p className="mt-2 text-sm text-destructive">{actionError}</p> : null}
      </Section>
    </PortalPage>
  );
}

function HeadToHeadRow({ row, isOwn = false }: { row: GapRow; isOwn?: boolean }) {
  const score = seoScoreOf(row);
  const schemas = asStringArray(row.profile?.schemaTypes);
  const rating = asReviewRating(row.profile?.reviewRating);
  const standing = row.aeoStanding;
  const standingTone = aeoTone(standing);
  const profiled = row.profile && row.profile.fetchStatus === 'OK';

  return (
    <tr className={isOwn ? 'bg-muted/50' : ''}>
      <td>
        <p className="font-medium">
          {row.name}
          {isOwn ? <span className="ml-2 text-xs font-medium text-muted-foreground">You</span> : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {!profiled ? (isOwn ? 'Not checked yet' : "Couldn't read this website") : (row.domain ?? 'No website on file')}
        </p>
      </td>
      <td>
        {score === null ? (
          <span className="text-muted-foreground">Not scored</span>
        ) : (
          <div className="flex min-w-32 items-center gap-2.5">
            <span className={`g-num w-7 font-semibold ${TONE_TEXT[scoreToneOf(score)]}`}>{score}</span>
            <div className="flex-1">
              <Meter value={score} tone={scoreToneOf(score)} height={5} label={`SEO score ${score} of 100`} />
            </div>
          </div>
        )}
      </td>
      <td>
        {schemas.length === 0 ? (
          <span className="text-muted-foreground">None found</span>
        ) : (
          <span title={schemas.join(', ')}>
            <span className="g-num font-medium">{schemas.length}</span>{' '}
            <span className="text-muted-foreground">
              {schemas.slice(0, 2).join(', ')}
              {schemas.length > 2 ? ` +${schemas.length - 2}` : ''}
            </span>
          </span>
        )}
      </td>
      <td className={rating ? 'g-num' : 'text-muted-foreground'}>{rating ? formatRating(rating) : 'None found'}</td>
      <td>
        {isOwn ? (
          <span className="text-muted-foreground">Not scored</span>
        ) : standingTone === 'none' ? (
          <span className="text-muted-foreground">Not seen together</span>
        ) : (
          <span className="flex flex-col">
            <StatusChip tone={standingTone === 'behind' ? 'bad' : standingTone === 'ahead' ? 'good' : 'neutral'}>
              {standingTone === 'behind' ? 'Picked over you' : standingTone === 'ahead' ? 'You win' : 'Even'}
            </StatusChip>
            <span className="mt-1 text-xs text-muted-foreground">
              You won {standing?.timesAhead ?? 0}, lost {standing?.timesBehind ?? 0}
            </span>
          </span>
        )}
      </td>
    </tr>
  );
}
