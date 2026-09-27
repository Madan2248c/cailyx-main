'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listTechnicalAuditRuns } from '@/lib/technical-api';
import { RankHistory } from '@/components/dashboard/RankHistory';
import { getAeoVerdict, listAeoAudits } from '@/lib/aeo-api';
import {
  getCompetitorGap,
  getGapAnalysisRun,
  listGapAnalysisRuns,
  listReports,
  listSocialActivityRuns,
} from '@/lib/dashboard-api';
import type { TechnicalAuditRun } from '@/types/technical';
import { CHECK_LABEL } from '@/types/technical';
import type { AeoVerdict } from '@/types/aeo';
import type {
  CompetitorGap,
  GapAnalysisRun,
  ProjectReport,
  SocialActivityRun,
} from '@/types/dashboard';
import { socialRunPlatforms } from '@/types/dashboard';

interface DashboardSnapshot {
  tech: TechnicalAuditRun | null;
  social: SocialActivityRun | null;
  aeo: { verdict: AeoVerdict; date: string | null } | null;
  gap: CompetitorGap | null;
  gapRun: GapAnalysisRun | null;
  report: ProjectReport | null;
}

interface AttentionItem {
  source: string;
  href: string;
  text: string;
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

function scoreTone(score: number | null): string {
  if (score === null) return 'text-muted-foreground';
  if (score >= 80) return 'text-green-600';
  if (score >= 50) return 'text-amber-600';
  return 'text-red-600';
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

  const base = `/client/projects/${projectId}`;

  useEffect(() => {
    let cancelled = false;

    const tech = listTechnicalAuditRuns(accessToken, clientId, projectId)
      .then((runs) => latestComplete(runs, 'COMPLETE'))
      .catch(() => null);

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

    Promise.all([tech, social, aeo, gap, gapRun, report])
      .then(([techRun, socialRun, aeoResult, competitorGap, gapAnalysisRun, latestReport]) => {
        if (!cancelled) {
          setSnapshot({
            tech: techRun,
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

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading dashboard…</p>
      </div>
    );
  }

  // ─── Headline derivations (insights first) ──────────────────────────
  const techScore = snapshot.tech?.score ?? null;

  const platforms = snapshot.social ? socialRunPlatforms(snapshot.social) : [];
  const quietPlatforms = platforms.filter((p) => p.pattern === 'dormant' || p.pattern === 'sporadic');
  const socialSummary =
    platforms.length === 0
      ? null
      : quietPlatforms.length > 0
        ? `${quietPlatforms.length} of ${platforms.length} channels quiet`
        : `Active on all ${platforms.length} channels`;

  const mentionRate = snapshot.aeo ? snapshot.aeo.verdict.counted.overall.mentionRate : null;

  const openRecs = (snapshot.gapRun?.recommendations ?? [])
    .filter((r) => r.status === 'OPEN')
    .sort((a, b) => a.priorityRank - b.priorityRank);

  // ─── Needs attention: worst tech failure, worst gap rec, losing prompt ─
  const attention: AttentionItem[] = [];
  const worstTech = (snapshot.tech?.findings ?? [])
    .filter((f) => f.status === 'fail' || f.status === 'error')
    .sort((a, b) => (a.severity === 'high' ? 0 : 1) - (b.severity === 'high' ? 0 : 1))[0];
  if (worstTech && snapshot.tech) {
    attention.push({
      source: 'Technical audit',
      href: `${base}/performance/technical`,
      text: `${CHECK_LABEL[worstTech.type] ?? worstTech.type}: ${truncate(worstTech.recommendedFix, 110)}`,
    });
  }
  if (openRecs[0]) {
    attention.push({
      source: 'Gap analysis',
      href: `${base}/reports`,
      text: `#${openRecs[0].priorityRank} priority: ${truncate(openRecs[0].title, 110)}`,
    });
  }
  const losingPrompt = snapshot.aeo?.verdict.judged?.losingPrompts[0];
  if (losingPrompt) {
    attention.push({
      source: 'AI visibility',
      href: `${base}/performance/visibility/ai`,
      text: `Losing to ${losingPrompt.losesTo.join(', ') || 'rivals'} on “${truncate(losingPrompt.prompt, 90)}”`,
    });
  }
  const topAttention = attention.slice(0, 3);

  // ─── Competitor gap derivation ──────────────────────────────────────
  const ownScore = snapshot.gap?.own.profile?.seoScore ?? null;
  const bestRival = (snapshot.gap?.competitors ?? [])
    .filter((c) => c.profile?.seoScore !== null && c.profile?.seoScore !== undefined)
    .sort((a, b) => (b.profile?.seoScore ?? 0) - (a.profile?.seoScore ?? 0))[0];
  const gapVsRival =
    ownScore !== null && bestRival?.profile?.seoScore !== null && bestRival?.profile?.seoScore !== undefined
      ? (bestRival.profile.seoScore as number) - ownScore
      : null;

  const tiles = [
    {
      label: 'Technical',
      href: `${base}/performance/technical`,
      value: techScore !== null ? `${techScore}/100` : null,
      valueClass: scoreTone(techScore),
      note:
        snapshot.tech == null
          ? 'Not yet audited — one runs automatically in your Day-1 pipeline.'
          : worstTech
            ? `${(snapshot.tech.findings ?? []).filter((f) => f.status === 'fail' || f.status === 'error').length} failing checks need fixes.`
            : 'All checks passing.',
    },
    {
      label: 'Social',
      href: `${base}/performance`,
      value: socialSummary,
      valueClass: 'text-foreground',
      note:
        snapshot.social == null
          ? 'Not yet audited — no social pull has completed for this project.'
          : quietPlatforms.length > 0
            ? `Quiet: ${quietPlatforms.map((p) => p.platform).join(', ')}.`
            : 'Cadence looks healthy everywhere we pull.',
    },
    {
      label: 'AI visibility',
      href: `${base}/performance/visibility/ai`,
      value: mentionRate !== null ? pct(mentionRate) : null,
      valueClass: 'text-foreground',
      note:
        snapshot.aeo == null
          ? 'Not yet audited — one runs automatically in your Day-1 pipeline.'
          : snapshot.aeo.verdict.judged && snapshot.aeo.verdict.judged.losingPrompts.length > 0
            ? `Losing ${snapshot.aeo.verdict.judged.losingPrompts.length} prompt${snapshot.aeo.verdict.judged.losingPrompts.length === 1 ? '' : 's'} to rivals.`
            : 'Holding your own across tested prompts.',
    },
    {
      label: 'Competitors',
      href: `${base}/competitors`,
      value:
        snapshot.gap == null
          ? null
          : `${snapshot.gap.competitors.length} rival${snapshot.gap.competitors.length === 1 ? '' : 's'} tracked`,
      valueClass: 'text-foreground',
      note:
        snapshot.gap == null
          ? 'No competitor comparison yet.'
          : gapVsRival !== null && bestRival
            ? gapVsRival > 0
              ? `Trailing ${bestRival.name} by ${gapVsRival} SEO points.`
              : `Leading ${bestRival.name} on homepage SEO.`
            : 'Comparison available — see the breakdown.',
    },
    {
      label: 'Open gaps',
      href: `${base}/reports`,
      value: snapshot.gapRun ? `${openRecs.length} open` : null,
      valueClass: openRecs.length > 0 ? 'text-amber-600' : 'text-green-600',
      note:
        snapshot.gapRun == null
          ? 'No gap analysis yet — recommendations appear after your source audits complete.'
          : openRecs.length > 0
            ? `Top: ${truncate(openRecs[0].title, 80)}`
            : 'Every recommendation is done or dismissed.',
    },
    {
      label: 'Reports',
      href: `${base}/reports`,
      value: snapshot.report ? snapshot.report.kind : null,
      valueClass: 'text-foreground',
      note: snapshot.report
        ? `Latest released ${formatDate(snapshot.report.releasedAt ?? snapshot.report.createdAt)}.`
        : 'No released report yet.',
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">{projectName}</h1>
        <p className="text-sm text-muted-foreground">{projectDomain}</p>
      </div>

      {/* 1) Headline row — project health at a glance */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Tech score</p>
            <p className={`text-3xl font-semibold ${scoreTone(techScore)}`}>
              {techScore ?? '—'}
              {techScore !== null ? <span className="text-base font-normal text-muted-foreground">/100</span> : null}
            </p>
            <p className="text-xs text-muted-foreground">
              {snapshot.tech ? `audited ${formatDate(snapshot.tech.completedAt ?? snapshot.tech.createdAt)}` : 'not yet audited'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Social cadence</p>
            <p className="text-3xl font-semibold">
              {snapshot.social ? `${platforms.length - quietPlatforms.length}/${platforms.length}` : '—'}
            </p>
            <p className="text-xs text-muted-foreground">
              {socialSummary ?? 'not yet audited'} · channels active
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <p className="text-xs font-medium text-muted-foreground">AI mention rate</p>
            <p className="text-3xl font-semibold">{mentionRate !== null ? pct(mentionRate) : '—'}</p>
            <p className="text-xs text-muted-foreground">
              {snapshot.aeo ? `across ${snapshot.aeo.verdict.counted.overall.observations} answers` : 'not yet audited'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Open gaps</p>
            <p className={`text-3xl font-semibold ${snapshot.gapRun ? (openRecs.length > 0 ? 'text-amber-600' : 'text-green-600') : ''}`}>
              {snapshot.gapRun ? openRecs.length : '—'}
            </p>
            <p className="text-xs text-muted-foreground">
              {snapshot.gapRun ? 'recommendations still open' : 'no gap analysis yet'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 2) Rank-history strip — omits itself when there is no rank history */}
      <RankHistory accessToken={accessToken} clientId={clientId} projectId={projectId} />

      {/* 3) Needs attention — top 3 cross-module actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Needs attention</CardTitle>
          <CardDescription>
            {topAttention.length === 0
              ? 'Nothing urgent — every module is either healthy or still waiting on its first run.'
              : 'The single most important action from each module, worst first.'}
          </CardDescription>
        </CardHeader>
        {topAttention.length > 0 ? (
          <CardContent className="flex flex-col p-0">
            {topAttention.map((item, i) => (
              <Link
                key={`${item.source}-${i}`}
                href={item.href}
                className={`flex items-baseline justify-between gap-3 px-6 py-2.5 text-sm hover:bg-muted/50 ${i > 0 ? 'border-t border-border' : ''}`}
              >
                <p className="min-w-0 flex-1 truncate">{item.text}</p>
                <p className="shrink-0 text-xs text-muted-foreground">{item.source} →</p>
              </Link>
            ))}
          </CardContent>
        ) : null}
      </Card>

      {/* 4) Latest report card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Latest report</CardTitle>
          <CardDescription>
            {snapshot.report
              ? `${snapshot.report.title} · released ${formatDate(snapshot.report.releasedAt ?? snapshot.report.createdAt)}`
              : 'No released report yet.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {snapshot.report ? (
            <p className="text-sm text-muted-foreground">{truncate(snapshot.report.executiveSummary, 280)}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Your first report appears here once the Day-1 pipeline finishes and releases it.
            </p>
          )}
          <Link href={`${base}/reports`} className="text-sm font-medium text-primary hover:underline">
            View all reports →
          </Link>
        </CardContent>
      </Card>

      {/* 5) KPI tiles per module */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <Link key={tile.label} href={tile.href} className="block">
            <Card className="h-full transition-colors hover:bg-muted/30">
              <CardContent className="flex flex-col gap-1 pt-5">
                <p className="text-xs font-medium text-muted-foreground">{tile.label}</p>
                <p className={`text-xl font-semibold ${tile.valueClass ?? ''}`}>
                  {tile.value ?? 'Not yet audited'}
                </p>
                <p className="text-xs text-muted-foreground">{tile.note}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
