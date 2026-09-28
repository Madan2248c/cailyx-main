'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CircleCheck, FileText, ListChecks, Scale, Share2, Swords, TriangleAlert, Trophy } from 'lucide-react';
import { Gauge } from '@/components/animate-ui/icons/gauge';
import { Lightbulb } from '@/components/animate-ui/icons/lightbulb';
import { Sparkles } from '@/components/animate-ui/icons/sparkles';
import { Highlight, HighlightItem } from '@/components/animate-ui/primitives/effects/highlight';
import { FirstRun } from '@/components/dashboard/FirstRun';
import { RankHistory } from '@/components/dashboard/RankHistory';
import { Meter, ScoreRing, Sparkline } from '@/components/portal/charts';
import { PageHeader, MetaDot, PortalPage, StatusChip, Tile, TileHeader, DeltaChip } from '@/components/portal/layout';
import { Marker } from '@/components/portal/marker';
import { CountUp } from '@/components/portal/motion';
import { ErrorState, PortalLoading } from '@/components/portal/states';
import { useFixSummary } from '@/components/remediation/use-fix-summary';
import { pct, plural, rateTone, relativeDate, scoreTone, TONE_TEXT, type Tone } from '@/components/portal/tone';
import { getAeoVerdict, listAeoAudits } from '@/lib/aeo-api';
import {
  getCompetitorGap,
  getGapAnalysisRun,
  listGapAnalysisRuns,
  listReports,
  listSocialActivityRuns,
} from '@/lib/dashboard-api';
import { getTechnicalAuditTrend, listTechnicalAuditRuns } from '@/lib/technical-api';
import type { AeoVerdict } from '@/types/aeo';
import { SURFACE_LABEL } from '@/types/aeo';
import type {
  ActivityPattern,
  CompetitorGap,
  GapAnalysisRun,
  ProjectReport,
  SocialActivityRun,
} from '@/types/dashboard';
import { socialRunPlatforms } from '@/types/dashboard';
import type { TechnicalAuditRun, TrendPoint } from '@/types/technical';
import { CHECK_LABEL } from '@/types/technical';

interface DashboardSnapshot {
  tech: TechnicalAuditRun | null;
  trend: TrendPoint[];
  social: SocialActivityRun | null;
  aeo: { verdict: AeoVerdict; date: string | null } | null;
  gap: CompetitorGap | null;
  gapRun: GapAnalysisRun | null;
  report: ProjectReport | null;
}

interface AttentionItem {
  source: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  text: string;
  tone: Tone;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function latestComplete<T extends { status: string; completedAt: string | null; createdAt: string }>(
  runs: T[],
  complete: string,
): T | null {
  const done = runs.filter((r) => r.status === complete);
  if (done.length === 0) return null;
  return done.sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt))[0];
}

const PATTERN_TONE: Record<ActivityPattern, Tone> = {
  daily: 'good',
  'every-2-3-days': 'good',
  weekly: 'good',
  sporadic: 'watch',
  dormant: 'bad',
};

const PLATFORM_LABEL: Record<string, string> = {
  linkedin: 'LinkedIn',
  x: 'X',
  twitter: 'X',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
};

function platformName(platform: string): string {
  return PLATFORM_LABEL[platform.toLowerCase()] ?? platform;
}

const PATTERN_WORD: Record<ActivityPattern, string> = {
  daily: 'Daily',
  'every-2-3-days': 'Every 2–3 days',
  weekly: 'Weekly',
  sporadic: 'Now and then',
  dormant: 'Gone quiet',
};

export function DashboardTab({
  accessToken,
  clientId,
  projectId,
  projectName,
  projectDomain,
}: {
  accessToken: string;
  clientId: string;
  projectId: string;
  projectName: string;
  projectDomain: string;
}) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fixSummary = useFixSummary(accessToken, clientId, projectId);

  const base = `/client/projects/${projectId}`;

  useEffect(() => {
    let cancelled = false;

    const tech = listTechnicalAuditRuns(accessToken, clientId, projectId)
      .then((runs) => latestComplete(runs, 'COMPLETE'))
      .catch(() => null);

    const trend = getTechnicalAuditTrend(accessToken, clientId, projectId).catch(() => [] as TrendPoint[]);

    const social = listSocialActivityRuns(accessToken, clientId, projectId)
      .then((runs) => latestComplete(runs, 'COMPLETE'))
      .catch(() => null);

    const aeo = listAeoAudits(accessToken, clientId, projectId)
      .then((audits) => {
        const done = audits.filter((a) => a.status === 'completed');
        if (done.length === 0) return null;
        const newest = done.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        return getAeoVerdict(accessToken, clientId, newest.id)
          .then((verdict) => ({ verdict, date: newest.finishedAt ?? newest.createdAt }))
          .catch(() => null);
      })
      .catch(() => null);

    const gap = getCompetitorGap(accessToken, clientId, projectId).catch(() => null);

    const gapRun = listGapAnalysisRuns(accessToken, clientId, projectId)
      .then((runs) => {
        const done = runs.filter((r) => r.status === 'COMPLETE');
        if (done.length === 0) return null;
        const newest = done.sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt))[0];
        return getGapAnalysisRun(accessToken, clientId, newest.id).catch(() => newest);
      })
      .catch(() => null);

    const report = listReports(accessToken, clientId, projectId)
      .then((reports) => {
        const released = reports.filter((r) => r.status === 'RELEASED');
        if (released.length === 0) return null;
        return released.sort((a, b) =>
          (b.releasedAt ?? b.createdAt).localeCompare(a.releasedAt ?? a.createdAt),
        )[0];
      })
      .catch(() => null);

    Promise.all([tech, trend, social, aeo, gap, gapRun, report])
      .then(([techRun, trendPoints, socialRun, aeoResult, competitorGap, gapAnalysisRun, latestReport]) => {
        if (!cancelled) {
          setSnapshot({
            tech: techRun,
            trend: trendPoints,
            social: socialRun,
            aeo: aeoResult,
            gap: competitorGap,
            gapRun: gapAnalysisRun,
            report: latestReport,
          });
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load the dashboard');
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, projectId]);

  if (error) return <ErrorState message={error} />;
  if (!snapshot) return <PortalLoading label="Loading dashboard" />;

  // ─── Derivations ────────────────────────────────────────────────────
  const techScore = snapshot.tech?.score ?? null;
  const techFindings = snapshot.tech?.findings ?? [];
  const failing = techFindings.filter((f) => f.status === 'fail' || f.status === 'error');
  const passing = techFindings.filter((f) => f.status === 'pass');
  const scoredTrend = snapshot.trend.filter((p) => p.score !== null).map((p) => p.score as number);
  const techChange = scoredTrend.length >= 2 ? scoredTrend[scoredTrend.length - 1] - scoredTrend[scoredTrend.length - 2] : null;

  const platforms = snapshot.social ? socialRunPlatforms(snapshot.social) : [];
  const quietPlatforms = platforms.filter((p) => p.pattern === 'dormant' || p.pattern === 'sporadic');
  const activePlatforms = platforms.length - quietPlatforms.length;

  const verdict = snapshot.aeo?.verdict ?? null;
  const mentionRate = verdict ? verdict.counted.overall.mentionRate : null;
  const winning = verdict?.judged?.winningPrompts ?? [];
  const losing = verdict?.judged?.losingPrompts ?? [];
  const firstPicks = verdict?.judged?.stanceCounts.recommended_primary ?? 0;
  const surfaces = [...(verdict?.counted.bySurface ?? [])].sort((a, b) => b.mentionRate - a.mentionRate);

  const openRecs = (snapshot.gapRun?.recommendations ?? [])
    .filter((r) => r.status === 'OPEN')
    .sort((a, b) => a.priorityRank - b.priorityRank);
  const doneRecs = (snapshot.gapRun?.recommendations ?? []).filter((r) => r.status === 'DONE');

  const ownSeo = snapshot.gap?.own.profile?.seoScore ?? null;
  const rivals = (snapshot.gap?.competitors ?? []).filter((c) => typeof c.profile?.seoScore === 'number');
  const bestRival = [...rivals].sort((a, b) => (b.profile?.seoScore ?? 0) - (a.profile?.seoScore ?? 0))[0] ?? null;
  const rivalsBeaten = rivals.filter((r) => ownSeo !== null && (r.profile?.seoScore ?? 0) < ownSeo).length;

  // ─── Needs attention: the worst thing from each source ─────────────
  const attention: AttentionItem[] = [];
  // A decision only the client can make blocks work, so it goes first.
  if (fixSummary && fixSummary.awaitingDecision > 0) {
    attention.push({
      source: 'Fix Plan',
      icon: Scale,
      href: `${base}/plan`,
      text: `${plural(fixSummary.awaitingDecision, 'fix', 'fixes')} ${fixSummary.awaitingDecision === 1 ? 'needs' : 'need'} your decision before work can go ahead`,
      tone: 'watch',
    });
  }
  const worstTech =[...failing].sort((a, b) => (a.severity === 'high' ? 0 : 1) - (b.severity === 'high' ? 0 : 1))[0];
  if (worstTech) {
    attention.push({
      source: 'Technical',
      icon: Gauge,
      href: `${base}/performance/technical`,
      text: `${CHECK_LABEL[worstTech.type] ?? worstTech.type}: ${truncate(worstTech.recommendedFix, 120)}`,
      tone: worstTech.severity === 'high' ? 'bad' : 'watch',
    });
  }
  if (losing[0]) {
    attention.push({
      source: 'AI answers',
      icon: Sparkles,
      href: `${base}/performance/visibility/ai`,
      text: `AI recommends ${losing[0].losesTo.join(', ') || 'a rival'} for “${truncate(losing[0].prompt, 80)}”`,
      tone: 'bad',
    });
  }
  if (openRecs[0]) {
    attention.push({
      source: 'Priorities',
      icon: Lightbulb,
      href: `${base}/reports`,
      text: `Priority ${openRecs[0].priorityRank}: ${truncate(openRecs[0].title, 110)}`,
      tone: 'watch',
    });
  }
  const quietest = platforms.find((p) => p.pattern === 'dormant') ?? quietPlatforms[0];
  if (quietest) {
    attention.push({
      source: 'Social',
      icon: Share2,
      href: `${base}/performance/social`,
      text: `${platformName(quietest.platform)} ${quietest.pattern === 'dormant' ? 'has gone quiet' : 'only posts now and then'}${quietest.daysSinceLastPost !== null ? `, last post ${Math.round(quietest.daysSinceLastPost)} days ago` : ''}`,
      tone: quietest.pattern === 'dormant' ? 'bad' : 'watch',
    });
  }

  // ─── What's working: evidence of progress, shown next to the asks ──
  const wins: string[] = [];
  if (firstPicks > 0) wins.push(`Recommended first in ${plural(firstPicks, 'AI answer')}`);
  if (winning.length > 0) wins.push(`Winning ${plural(winning.length, 'buyer question')}`);
  if (techScore !== null && techScore >= 80) wins.push(`Technical health is strong at ${techScore}/100`);
  if (techChange !== null && techChange > 0) wins.push(`Technical score up ${techChange} points since the last audit`);
  if (passing.length > 0 && snapshot.tech) wins.push(`${passing.length} of ${techFindings.length} technical checks pass`);
  if (rivalsBeaten > 0) wins.push(`Ahead of ${plural(rivalsBeaten, 'tracked rival')} on homepage SEO`);
  if (activePlatforms > 0) wins.push(`Active on ${plural(activePlatforms, 'social channel')}`);
  if (doneRecs.length > 0) wins.push(`${plural(doneRecs.length, 'priority', 'priorities')} completed`);

  // ─── The one-sentence answer ────────────────────────────────────────
  const newest = [snapshot.tech?.completedAt, snapshot.aeo?.date, snapshot.social?.completedAt]
    .filter((d): d is string => !!d)
    .sort()
    .at(-1);
  const summaryParts: string[] = [];
  if (attention.length > 0 || wins.length > 0) {
    summaryParts.push(
      `${attention.length === 0 ? 'Nothing needs attention right now' : `${plural(attention.length, 'thing')} ${attention.length === 1 ? 'needs' : 'need'} attention`}${wins.length > 0 ? `, and ${plural(wins.length, 'thing')} ${wins.length === 1 ? 'is' : 'are'} working` : ''}.`,
    );
  }

  const aeoTone = rateTone(mentionRate);
  const techTone = scoreTone(techScore);

  // Nothing measured yet: one "here's what's happening" view beats a grid
  // of empty tiles that all say the same thing.
  const nothingYet =
    !snapshot.tech && !verdict && platforms.length === 0 && ownSeo === null && !snapshot.gapRun && !snapshot.report && !(fixSummary && fixSummary.total > 0);
  if (nothingYet) {
    return (
      <FirstRun
        projectName={projectName}
        projectDomain={projectDomain}
        steps={[
          { label: 'Technical health', detail: 'Can search engines and AI tools reach and read your site?', done: !!snapshot.tech },
          { label: 'AI visibility', detail: 'How often ChatGPT, Perplexity and Gemini name you when buyers ask.', done: !!verdict },
          { label: 'Social channels', detail: 'How often you post, and which channels have gone quiet.', done: platforms.length > 0 },
          { label: 'Your rivals', detail: 'How you compare with the companies buyers weigh you against.', done: ownSeo !== null },
          { label: 'Your first report and Fix Plan', detail: 'What to fix first, with ready-made fixes for your developer.', done: !!snapshot.report },
        ]}
      />
    );
  }

  return (
    <PortalPage>
      <PageHeader
        eyebrow="Project overview"
        title={projectName}
        meta={
          <>
            <span>{projectDomain}</span>
            {newest ? (
              <>
                <MetaDot />
                <span>Updated {relativeDate(newest)}</span>
              </>
            ) : null}
          </>
        }
        summary={
          <>
            {mentionRate !== null ? (
              <>
                AI engines name {projectName} in <Marker text={pct(mentionRate)} /> of the answers we tested.
              </>
            ) : (
              'Your AI visibility is still being measured.'
            )}{' '}
            {summaryParts.join(' ')}
          </>
        }
      />

      {/* ─── Bento: the answer first ─────────────────────────────────── */}
      <div className="grid auto-rows-[minmax(0,auto)] grid-cols-1 gap-4 md:grid-cols-4">
        {/* Hero: AI visibility, the product's reason to exist */}
        <Tile ink shine href={`${base}/performance/visibility/ai`} index={0} className="md:col-span-2 md:row-span-2 gap-5 p-6" ariaLabel="AI visibility details">
          <TileHeader icon={Sparkles} eyebrow="AI visibility" linkHint hint="How often ChatGPT, Perplexity and Gemini name your company when buyers ask the questions we track. A rate across many answers, not a ranking." />
          {verdict ? (
            <>
              <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
                <ScoreRing
                  value={Math.round(verdict.counted.overall.mentionRate * 100)}
                  tone={aeoTone === 'neutral' ? 'neutral' : aeoTone}
                  onInk
                  size={148}
                  stroke={12}
                  label={`Mentioned in ${pct(verdict.counted.overall.mentionRate)} of AI answers`}
                >
                  <span className="text-4xl font-semibold text-white">
                    <CountUp value={Math.round(verdict.counted.overall.mentionRate * 100)} suffix="%" />
                  </span>
                  <span className="text-xs text-white/60">mention rate</span>
                </ScoreRing>
                <div className="flex min-w-0 flex-col gap-2">
                  <p className="text-xl font-semibold leading-snug text-white">
                    Named in {pct(verdict.counted.overall.mentionRate)} of AI answers
                  </p>
                  <p className="text-sm text-white/65">
                    Across {verdict.counted.overall.observations.toLocaleString()} answers from{' '}
                    {plural(verdict.counted.bySurface.length, 'engine')}. Cited as a source in {pct(verdict.counted.overall.citationRate)}.
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-white/10 px-2.5 py-1 text-white/85">
                      <span className="text-[#86d4a8]">▲</span> {plural(winning.length, 'question')} won
                    </span>
                    <span className="rounded-full bg-white/10 px-2.5 py-1 text-white/85">
                      <span className="text-[#f2a19a]">▼</span> {plural(losing.length, 'question')} lost to rivals
                    </span>
                  </div>
                </div>
              </div>
              {surfaces.length > 0 ? (
                <div className="mt-auto flex flex-col gap-2.5 border-t border-white/10 pt-4">
                  {surfaces.slice(0, 4).map((s, i) => (
                    <div key={s.surface} className="grid grid-cols-[6.5rem_1fr_2.75rem] items-center gap-3 text-sm">
                      <span className="truncate text-white/70">{SURFACE_LABEL[s.surface] ?? s.surface}</span>
                      <Meter value={s.mentionRate * 100} onInk tone="neutral" index={i + 2} label={`${SURFACE_LABEL[s.surface] ?? s.surface}: ${pct(s.mentionRate)}`} />
                      <span className="g-num text-right font-medium text-white">{pct(s.mentionRate)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex flex-1 flex-col justify-center gap-2">
              <p className="text-xl font-semibold text-white">Being measured now</p>
              <p className="max-w-sm text-sm text-white/65">
                We&apos;re asking ChatGPT, Perplexity and Gemini the questions your buyers ask. Your score appears here as soon as the answers are in.
              </p>
            </div>
          )}
        </Tile>

        {/* Technical health */}
        <Tile href={`${base}/performance/technical`} index={1} ariaLabel="Technical health details">
          <TileHeader icon={Gauge} eyebrow="Technical health" linkHint hint="Whether search engines and AI crawlers can reach, read and understand your site, scored out of 100." />
          {snapshot.tech ? (
            <div className="flex flex-1 flex-col justify-between gap-3">
              <div className="flex items-center gap-4">
                <ScoreRing value={techScore} tone={techTone} size={72} stroke={7} index={1} label={`Technical score ${techScore ?? 'not available'} out of 100`}>
                  <span className={`text-xl font-semibold ${TONE_TEXT[techTone]}`}>
                    {techScore !== null ? <CountUp value={techScore} /> : '—'}
                  </span>
                </ScoreRing>
                <div className="flex flex-col gap-1">
                  <StatusChip tone={techTone}>{techScore === null ? 'No score' : techTone === 'good' ? 'Healthy' : techTone === 'watch' ? 'Needs work' : 'At risk'}</StatusChip>
                  <p className="text-xs text-muted-foreground">{failing.length === 0 ? 'All checks pass' : `${plural(failing.length, 'check')} failing`}</p>
                </div>
              </div>
              <div className="flex items-end justify-between gap-2">
                <span title="Change since the last audit"><DeltaChip change={techChange} /></span>
                <Sparkline points={scoredTrend} tone={techTone} width={96} height={32} label={`Technical score trend over ${scoredTrend.length} audits`} />
              </div>
            </div>
          ) : (
            <NotYet text="Your first site check is running." />
          )}
        </Tile>

        {/* Fix Plan once one exists; the ranked priorities until then */}
        {fixSummary && fixSummary.total > 0 ? (
          <Tile href={`${base}/plan`} index={2} ariaLabel="Fix Plan">
            <TileHeader
              icon={ListChecks}
              eyebrow="Fix Plan"
              linkHint
              hint="Every problem from your audits as a clear fix. A fix counts as verified only when we confirm it on your live site."
            />
            <div className="flex flex-1 flex-col justify-between gap-3">
              <div className="flex items-center gap-4">
                <ScoreRing
                  value={Math.round((fixSummary.verified / Math.max(1, fixSummary.total - (fixSummary.byStatus.DISMISSED ?? 0))) * 100)}
                  tone="good"
                  size={64}
                  stroke={6}
                  index={2}
                  label={`${fixSummary.verified} fixes verified`}
                >
                  <span className="text-lg font-semibold">
                    <CountUp value={fixSummary.verified} />
                  </span>
                </ScoreRing>
                <p className="text-sm text-muted-foreground">
                  verified of {fixSummary.total - (fixSummary.byStatus.DISMISSED ?? 0)}
                </p>
              </div>
              {fixSummary.awaitingDecision > 0 ? (
                <StatusChip tone="watch">{plural(fixSummary.awaitingDecision, 'decision')} waiting on you</StatusChip>
              ) : fixSummary.verifiedSinceBaseline > 0 ? (
                <DeltaChip change={fixSummary.verifiedSinceBaseline} suffix="since you started" />
              ) : (
                <p className="text-xs text-muted-foreground">Nothing is waiting on you.</p>
              )}
            </div>
          </Tile>
        ) : (
        <Tile href={`${base}/reports`} index={2} ariaLabel="Priorities">
          <TileHeader icon={Lightbulb} eyebrow="Open priorities" linkHint hint="The ranked list of what to do next, drawn from all your audits. Numbered by impact." />
          {snapshot.gapRun ? (
            <div className="flex flex-1 flex-col gap-2">
              <p className={`text-4xl font-semibold ${openRecs.length > 0 ? 'text-warning' : 'text-success'}`}>
                <CountUp value={openRecs.length} />
              </p>
              <p className="line-clamp-2 text-sm text-muted-foreground">
                {openRecs.length > 0 ? `Next: ${openRecs[0].title}` : 'Every priority is done or dismissed.'}
              </p>
              {doneRecs.length > 0 ? <p className="mt-auto text-xs text-success">{plural(doneRecs.length, 'priority', 'priorities')} completed</p> : null}
            </div>
          ) : (
            <NotYet text="Your priorities appear once the first checks finish." />
          )}
        </Tile>
        )}

        {/* Social cadence */}
        <Tile href={`${base}/performance/social`} index={3} ariaLabel="Social activity details">
          <TileHeader icon={Share2} eyebrow="Social channels" linkHint />
          {snapshot.social && platforms.length > 0 ? (
            <div className="flex flex-1 flex-col gap-3">
              <p className="text-sm">
                <span className="g-num text-2xl font-semibold">{activePlatforms}</span>
                <span className="text-muted-foreground"> of {platforms.length} channels active</span>
              </p>
              <ul className="flex flex-col gap-1.5">
                {platforms.slice(0, 4).map((p) => (
                  <li key={p.platform} className="flex items-center justify-between gap-2 text-sm">
                    <span>{platformName(p.platform)}</span>
                    <StatusChip tone={PATTERN_TONE[p.pattern]}>{PATTERN_WORD[p.pattern]}</StatusChip>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <NotYet text="We're checking your channels." />
          )}
        </Tile>

        {/* Competitors */}
        <Tile href={`${base}/competitors`} index={4} ariaLabel="Competitor comparison">
          <TileHeader icon={Swords} eyebrow="Versus rivals" linkHint hint="Your homepage SEO score next to your strongest tracked competitor." />
          {ownSeo !== null && bestRival ? (
            <div className="flex flex-1 flex-col justify-center gap-3">
              <CompareRow name="You" value={ownSeo} strong index={1} />
              <CompareRow name={bestRival.name} value={bestRival.profile?.seoScore ?? 0} index={2} />
              <p className="text-xs text-muted-foreground">
                {ownSeo >= (bestRival.profile?.seoScore ?? 0)
                  ? `Leading your strongest rival on homepage SEO.`
                  : `${(bestRival.profile?.seoScore ?? 0) - ownSeo} points behind your strongest rival.`}
              </p>
            </div>
          ) : (
            <NotYet text={snapshot.gap ? "We're reading your rivals' websites." : 'Pick the rivals to compare against.'} />
          )}
        </Tile>

        {/* Needs attention */}
        <Tile index={5} className="md:col-span-3 p-0">
          <div className="px-5 pt-5">
            <TileHeader
              icon={TriangleAlert}
              eyebrow="Needs attention"
              right={attention.length > 0 ? <span className="text-xs text-muted-foreground">Most important first</span> : null}
            />
          </div>
          {attention.length === 0 ? (
            <div className="flex items-center gap-3 px-5 pb-5 text-sm text-muted-foreground">
              <CircleCheck className="size-5 text-success" />
              Nothing needs your attention right now.
            </div>
          ) : (
            <Highlight
              controlledItems
              hover
              click={false}
              mode="children"
              className="inset-x-2 inset-y-0 rounded-xl bg-muted"
              transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            >
            <ul className="flex flex-col pb-2">
              {attention.map((item) => (
                <HighlightItem key={item.source} as="li" value={item.source}>
                  <Link href={item.href} className="flex items-center gap-3 px-5 py-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-ring">
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg"
                      style={{ background: item.tone === 'bad' ? 'var(--danger-soft)' : 'var(--warning-soft)' }}
                    >
                      <item.icon className={`size-4 ${TONE_TEXT[item.tone]}`} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-muted-foreground">{item.source}</span>
                      <span className="block truncate text-sm">{item.text}</span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </HighlightItem>
              ))}
            </ul>
            </Highlight>
          )}
        </Tile>

        {/* What's working */}
        <Tile index={6} className="md:row-span-2">
          <TileHeader icon={Trophy} eyebrow="What's working" />
          {wins.length === 0 ? (
            <p className="text-sm text-muted-foreground">Your wins will show up here as results come in.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {wins.slice(0, 6).map((w) => (
                <li key={w} className="flex items-start gap-2.5 text-sm">
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
        </Tile>

        {/* Latest report */}
        <Tile href={`${base}/reports`} index={7} className="md:col-span-3" ariaLabel="Reports">
          <TileHeader
            icon={FileText}
            eyebrow="Latest report"
            linkHint
            title={snapshot.report ? snapshot.report.title : undefined}
          />
          {snapshot.report ? (
            <div className="flex flex-col gap-2">
              <p className="line-clamp-3 text-sm text-muted-foreground">{snapshot.report.executiveSummary}</p>
              <p className="text-xs text-muted-foreground">
                {snapshot.report.kind === 'DAY1' ? 'Starting-point report' : 'Monthly report'} · released {relativeDate(snapshot.report.releasedAt ?? snapshot.report.createdAt)}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Your first report appears here once your Rothenhall lead has reviewed and released it.</p>
          )}
        </Tile>
      </div>

      {/* Search ranking movement: omits itself when there is nothing to show */}
      <RankHistory accessToken={accessToken} clientId={clientId} projectId={projectId} />
    </PortalPage>
  );
}

function NotYet({ text }: { text: string }) {
  return (
    <div className="flex flex-1 items-center gap-2 text-sm text-muted-foreground">
      <span className="g-live size-1.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />
      {text}
    </div>
  );
}

function CompareRow({ name, value, strong = false, index = 0 }: { name: string; value: number; strong?: boolean; index?: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className={strong ? 'font-semibold' : 'truncate text-muted-foreground'}>{name}</span>
        <span className="g-num font-medium">{value}</span>
      </div>
      <Meter value={value} color={strong ? 'var(--g-ink)' : 'var(--g-ink-muted)'} index={index} height={5} label={`${name}: ${value} of 100`} />
    </div>
  );
}
