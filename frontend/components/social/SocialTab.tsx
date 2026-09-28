'use client';

import { useEffect, useState } from 'react';
import { Share2 } from 'lucide-react';
import { listSocialActivityRuns } from '@/lib/social-api';
import {
  PATTERN_LABEL,
  PATTERN_ORDER,
  socialRunPlatforms,
  type ActivityPattern,
  type SocialActivityDelta,
  type SocialActivityRun,
  type SocialPlatformActivity,
} from '@/types/social';
import { EmptyPage, NextSteps, Section, Stat, StatRow, type NextStep } from '@/components/portal/blocks';
import { MetaDot, PageHeader, PortalPage, StatusChip } from '@/components/portal/layout';
import { ErrorState, PortalLoading } from '@/components/portal/states';
import { plural, relativeDate, type Tone } from '@/components/portal/tone';
import { platformName } from '@/components/portal/words';

function formatDate(iso: string | null): string {
  if (!iso) return 'Unknown';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysAgo(days: number): string {
  const d = Math.round(days);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

const PATTERN_TONE: Record<ActivityPattern, Tone> = {
  daily: 'good',
  'every-2-3-days': 'good',
  weekly: 'good',
  sporadic: 'watch',
  dormant: 'bad',
};

/** Cadence as a chip word; "Dormant" reads as jargon, "Gone quiet" doesn't. */
const PATTERN_WORD: Record<ActivityPattern, string> = {
  daily: 'Daily',
  'every-2-3-days': 'Every 2–3 days',
  weekly: 'Weekly',
  sporadic: 'Now and then',
  dormant: 'Gone quiet',
};

function cadenceWord(value: number | string | null): string {
  if (value === null) return 'unknown';
  return (PATTERN_WORD[value as ActivityPattern] ?? String(value)).toLowerCase();
}

const DELTA_LABEL: Record<SocialActivityDelta['metric'], string> = {
  followers: 'followers',
  postsInWindow: 'posts in 30 days',
  pattern: 'posting rhythm',
  daysSinceLastPost: 'days since last post',
};

function formatDeltaValue(metric: SocialActivityDelta['metric'], value: number | string | null): string {
  if (value === null) return 'none';
  if (metric === 'pattern') return PATTERN_LABEL[value as ActivityPattern] ?? String(value);
  if (typeof value === 'number') return Math.round(value).toLocaleString();
  return String(value);
}

/** Renders the analyst narrative (three `##` sections) without a markdown dep. */
function Narrative({ text }: { text: string }) {
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  return (
    <div className="flex flex-col gap-3 text-sm">
      {blocks.map((block, i) => {
        const lines = block
          .split('\n')
          .map((l) => l.trim().replace(/^#{1,3}\s*/, ''))
          .filter(Boolean);
        const isHeading = /^#{1,3}\s/.test(block.split('\n')[0] ?? '');
        if (isHeading && lines.length > 0) {
          const [heading, ...rest] = lines;
          return (
            <div key={i} className="flex flex-col gap-1">
              <h3 className="font-medium">{heading}</h3>
              {rest.map((line, j) => (
                <p key={j} className="text-muted-foreground">
                  {line}
                </p>
              ))}
            </div>
          );
        }
        return (
          <p key={i} className="text-muted-foreground">
            {lines.join(' ')}
          </p>
        );
      })}
    </div>
  );
}

export function SocialTab({
  accessToken,
  clientId,
  projectId,
  projectName,
}: {
  accessToken: string;
  clientId: string;
  projectId: string;
  projectName: string;
}) {
  const [runs, setRuns] = useState<SocialActivityRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    listSocialActivityRuns(accessToken, clientId, projectId)
      .then((runList) => {
        if (!cancelled) setRuns(runList);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load social activity');
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, projectId]);

  if (error) return <ErrorState title="We couldn't load your social channels" message={error} />;
  if (!runs) return <PortalLoading label="Loading social activity" />;

  const completed = runs
    .filter((r) => r.status === 'COMPLETE')
    .sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt));
  const latest = completed[0] ?? null;
  const pending = runs.find((r) => r.status === 'QUEUED' || r.status === 'RUNNING') ?? null;

  if (!latest) {
    const failed = runs.find((r) => r.status === 'FAILED') ?? null;
    return (
      <EmptyPage
        eyebrow="Performance"
        title="Social channels"
        projectName={projectName}
        emptyTitle={pending ? 'Checking your channels now' : failed ? "We couldn't finish the first check" : 'Your social check is on its way'}
        body={
          pending
            ? 'We are looking at how often you post on each channel. This page fills in when the check finishes.'
            : failed
              ? 'Something went wrong while checking your channels. It will run again automatically, and your Rothenhall lead has been told.'
              : 'This page will show how often you post on each channel, which ones have gone quiet and what changed since last time.'
        }
        steps={
          pending || failed
            ? undefined
            : [
                'We find your company pages on LinkedIn, X, Instagram and other channels.',
                'We look at your posts from the last 30 days on each one.',
                'You see which channels are active, which have gone quiet and what to do about it.',
              ]
        }
      />
    );
  }

  const platforms = socialRunPlatforms(latest).sort(
    (a, b) => PATTERN_ORDER.indexOf(a.pattern) - PATTERN_ORDER.indexOf(b.pattern),
  );
  const quiet = platforms.filter((p) => p.pattern === 'dormant');
  const active = platforms.filter((p) => p.pattern !== 'dormant' && p.pattern !== 'sporadic');
  const postsInWindow = platforms.reduce((n, p) => n + p.postsInWindow, 0);

  // ─── What to do next, worst first ───────────────────────────────────
  const steps: NextStep[] = [];
  for (const finding of latest.findings.filter((f) => f.status === 'fail')) {
    steps.push({ tone: 'bad', lead: `${platformName(finding.platform)}:`, text: finding.detail });
  }
  for (const delta of latest.deltas) {
    if (delta.metric === 'pattern' && delta.previous !== delta.current) {
      steps.push({
        tone: 'watch',
        lead: `${platformName(delta.platform)} changed rhythm.`,
        text: `It went from ${cadenceWord(delta.previous)} to ${cadenceWord(delta.current)} since the last check.`,
      });
    }
  }
  const couldNotCheck = latest.findings.filter((f) => f.status === 'error' || f.status === 'not-run');

  const previousRun = latest.previousRunId ? runs.find((r) => r.id === latest.previousRunId) ?? null : null;
  const checkedOn = latest.completedAt ?? latest.createdAt;
  const changes = latest.deltas.filter((d) => d.metric !== 'pattern').slice(0, 8);

  return (
    <PortalPage>
      <PageHeader
        eyebrow="Performance"
        title="Social channels"
        meta={
          <>
            <span>{projectName}</span>
            <MetaDot />
            <span>Checked {relativeDate(checkedOn)}</span>
          </>
        }
        summary={
          platforms.length === 0
            ? 'We could not find any company channels to check.'
            : quiet.length === 0
              ? `You're posting regularly on ${active.length === platforms.length ? 'every channel' : `${active.length} of ${plural(platforms.length, 'channel')}`}. Buyers and AI tools both notice steady activity.`
              : `${plural(quiet.length, 'channel has', 'channels have')} gone quiet. A quiet channel can look like a closed business to buyers.`
        }
      />

      <StatRow>
        <Stat
          index={1}
          label="Active channels"
          value={active.length}
          unit={`of ${platforms.length}`}
          tone={platforms.length > 0 && active.length === platforms.length ? 'good' : 'neutral'}
          caption="Posting at least once a week"
        />
        <Stat index={2} label="Posts" value={postsInWindow} caption="In the last 30 days, all channels" />
        <Stat
          index={3}
          label="Quiet channels"
          value={quiet.length}
          tone={quiet.length > 0 ? 'bad' : 'good'}
          caption={quiet.length > 0 ? quiet.map((p) => platformName(p.platform)).join(', ') : 'None, nice work'}
        />
      </StatRow>

      <NextSteps index={4} items={steps} allClear="Nothing needs attention. Every channel is posting on a steady rhythm." />

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Section index={5} icon={Share2} eyebrow="Each channel" description="How often you post, over the last 30 days." flush>
          <ul className="flex flex-col pb-2">
            {platforms.map((p: SocialPlatformActivity) => (
              <li key={p.platform} className="flex flex-col gap-1.5 border-t border-border px-5 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{platformName(p.platform)}</p>
                  <StatusChip tone={PATTERN_TONE[p.pattern]}>{PATTERN_WORD[p.pattern]}</StatusChip>
                </div>
                <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
                  <span>
                    <span className="g-num font-medium text-foreground">{p.postsInWindow}</span> posts
                  </span>
                  {p.daysSinceLastPost !== null && Number.isFinite(p.daysSinceLastPost) ? (
                    <span>
                      Last post <span className="font-medium text-foreground">{daysAgo(p.daysSinceLastPost)}</span>
                    </span>
                  ) : null}
                  {p.followerCount !== null ? (
                    <span>
                      <span className="g-num font-medium text-foreground">{Math.round(p.followerCount).toLocaleString()}</span> followers
                    </span>
                  ) : null}
                  {p.avgEngagement !== null ? (
                    <span title="Average likes, comments and shares per post">
                      <span className="g-num font-medium text-foreground">{Math.round(p.avgEngagement).toLocaleString()}</span> reactions per post
                    </span>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        </Section>

        <div className="flex flex-col gap-4">
          {changes.length > 0 ? (
            <Section
              index={6}
              eyebrow="Since the last check"
              description={previousRun ? `Compared with ${formatDate(previousRun.completedAt ?? previousRun.createdAt)}.` : undefined}
            >
              <dl className="flex flex-col gap-2.5 text-sm">
                {changes.map((d, i) => (
                  <div key={`${d.platform}-${d.metric}-${i}`} className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">
                      {platformName(d.platform)} {DELTA_LABEL[d.metric] ?? d.metric}
                    </dt>
                    <dd className="g-num shrink-0">
                      <span className="text-muted-foreground">{formatDeltaValue(d.metric, d.previous)}</span>
                      <span className="text-muted-foreground"> → </span>
                      <span className="font-semibold">{formatDeltaValue(d.metric, d.current)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </Section>
          ) : null}

          {latest.narrative ? (
            <Section index={7} eyebrow="Notes from your analyst">
              <Narrative text={latest.narrative} />
            </Section>
          ) : null}
        </div>
      </div>

      {couldNotCheck.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          We couldn&apos;t check {couldNotCheck.map((f) => platformName(f.platform)).filter((v, i, a) => a.indexOf(v) === i).join(', ')} this time.
          We&apos;ll try again at the next check.
        </p>
      ) : null}
    </PortalPage>
  );
}
