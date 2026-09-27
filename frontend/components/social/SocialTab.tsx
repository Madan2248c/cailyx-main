'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listSocialActivityRuns } from '@/lib/social-api';
import {
  PATTERN_LABEL,
  PATTERN_ORDER,
  socialRunPlatforms,
  type ActivityPattern,
  type SocialActivityDelta,
  type SocialActivityFinding,
  type SocialActivityRun,
  type SocialPlatformActivity,
} from '@/types/social';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

function formatDays(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 10) / 10}d`;
}

function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return String(Math.round(value));
}

/** Health dot per platform: worst finding status wins, pass only when clean. */
function platformTone(platform: string, findings: SocialActivityFinding[]): string {
  const forPlatform = findings.filter((f) => f.platform === platform);
  if (forPlatform.some((f) => f.status === 'fail')) return 'bg-red-500';
  if (forPlatform.some((f) => f.status === 'error')) return 'bg-amber-500';
  if (forPlatform.some((f) => f.status === 'not-run')) return 'bg-muted-foreground/40';
  return 'bg-green-500';
}

function patternTone(pattern: ActivityPattern): string {
  if (pattern === 'daily' || pattern === 'every-2-3-days') return 'text-green-600';
  if (pattern === 'weekly') return 'text-emerald-600';
  if (pattern === 'sporadic') return 'text-amber-600';
  return 'text-red-600';
}

function findingTone(finding: SocialActivityFinding): string {
  if (finding.status === 'fail') return 'border-red-500/30 bg-red-500/5';
  if (finding.status === 'error') return 'border-amber-500/30 bg-amber-500/5';
  return 'border-border';
}

const DELTA_LABEL: Record<SocialActivityDelta['metric'], string> = {
  followers: 'Followers',
  postsInWindow: 'Posts in window',
  pattern: 'Cadence',
  daysSinceLastPost: 'Days since last post',
};

function formatDeltaValue(metric: SocialActivityDelta['metric'], value: number | string | null): string {
  if (value === null) return '—';
  if (metric === 'pattern') {
    const label = PATTERN_LABEL[value as ActivityPattern];
    return label ?? String(value);
  }
  if (typeof value === 'number') {
    return metric === 'daysSinceLastPost' ? formatDays(value) : formatCount(value);
  }
  return String(value);
}

function platformLabel(platform: string): string {
  return platform.length <= 2 ? platform.toUpperCase() : platform.replace(/\b\w/g, (c) => c.toUpperCase());
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

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!runs) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading social activity…</p>
      </div>
    );
  }

  const completed = runs
    .filter((r) => r.status === 'COMPLETE')
    .sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt));
  const latest = completed[0] ?? null;
  const pending = runs.find((r) => r.status === 'QUEUED' || r.status === 'RUNNING') ?? null;

  if (!latest) {
    const failed = runs.find((r) => r.status === 'FAILED') ?? null;
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6">
        <h1 className="text-2xl font-semibold">Social</h1>
        <p className="mt-1 text-sm text-muted-foreground">{projectName}</p>
        <Card className="mt-4">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {pending
                ? 'A social pull is running right now — check back when it completes.'
                : failed
                  ? 'The last social pull failed before it could record anything. One reruns automatically on its schedule.'
                  : 'No completed social pull yet. One runs automatically as part of your Day-1 pipeline.'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const platforms = socialRunPlatforms(latest).sort(
    (a, b) => PATTERN_ORDER.indexOf(a.pattern) - PATTERN_ORDER.indexOf(b.pattern),
  );
  const dormant = platforms.filter((p) => p.pattern === 'dormant');
  const healthy = platforms.filter((p) => p.pattern !== 'dormant' && p.pattern !== 'sporadic');
  const postsInWindow = platforms.reduce((n, p) => n + p.postsInWindow, 0);

  // ─── Insights first: what needs attention, worst first ──────────────
  const attention: Array<{ tone: string; text: string }> = [];
  for (const finding of latest.findings) {
    if (finding.status === 'fail') {
      attention.push({ tone: 'bg-red-500', text: finding.detail });
    }
  }
  for (const finding of latest.findings) {
    if (finding.status === 'error') {
      attention.push({ tone: 'bg-amber-500', text: finding.detail });
    }
  }
  for (const delta of latest.deltas) {
    if (delta.metric === 'pattern' && delta.previous !== delta.current) {
      attention.push({
        tone: 'bg-amber-500',
        text: `${platformLabel(delta.platform)} cadence moved from ${formatDeltaValue('pattern', delta.previous)} to ${formatDeltaValue('pattern', delta.current)} since the previous pull.`,
      });
    }
  }
  const notes = latest.findings.filter((f) => f.status === 'not-run');

  const previousRun = latest.previousRunId ? runs.find((r) => r.id === latest.previousRunId) ?? null : null;
  const ceilingHit = latest.result.ceilingHit === true;
  const auditedOn = formatDate(latest.completedAt ?? latest.createdAt);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Social</h1>
        <p className="text-sm text-muted-foreground">
          {projectName} · pulled {auditedOn}
        </p>
      </div>

      {/* 1) Cadence health — what needs attention */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cadence health</CardTitle>
          <CardDescription>
            {attention.length === 0
              ? 'Nothing urgent — every channel we pull is posting on a steady rhythm.'
              : `${attention.length} thing${attention.length === 1 ? '' : 's'} worth a look, worst first.`}
          </CardDescription>
        </CardHeader>
        {attention.length > 0 ? (
          <CardContent className="flex flex-col gap-2">
            {attention.map((item, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${item.tone}`} />
                <p>{item.text}</p>
              </div>
            ))}
          </CardContent>
        ) : (
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Active on all {platforms.length} channel{platforms.length === 1 ? '' : 's'} — no dormant or
              stalled feeds in this pull.
            </p>
          </CardContent>
        )}
      </Card>

      {/* 2) KPI tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col gap-2 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Active platforms</p>
            <p className="text-4xl font-semibold">
              {healthy.length}
              <span className="text-base font-normal text-muted-foreground">/{platforms.length}</span>
            </p>
            <p className="text-xs text-muted-foreground">posting on a steady rhythm</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-2 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Posts in window</p>
            <p className="text-4xl font-semibold">{postsInWindow}</p>
            <p className="text-xs text-muted-foreground">last 30 days, all channels</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-2 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Dormant</p>
            <p className={`text-4xl font-semibold ${dormant.length > 0 ? 'text-red-600' : ''}`}>
              {dormant.length}
            </p>
            <p className="text-xs text-muted-foreground">
              {dormant.length > 0 ? dormant.map((p) => platformLabel(p.platform)).join(', ') : 'no quiet channels'}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="columns-1 gap-4 lg:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
        {/* 3) Per-platform cadence */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cadence by platform</CardTitle>
            <CardDescription>Posting rhythm over the 30-day window</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col p-0">
            {platforms.map((p: SocialPlatformActivity, i: number) => (
              <div
                key={p.platform}
                className={`flex flex-col gap-1.5 px-6 py-3 ${i > 0 ? 'border-t border-border' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`size-2 rounded-full ${platformTone(p.platform, latest.findings)}`} />
                  <p className="font-medium">{platformLabel(p.platform)}</p>
                  <p className={`ml-auto text-sm font-medium ${patternTone(p.pattern)}`}>
                    {PATTERN_LABEL[p.pattern] ?? p.pattern}
                  </p>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 pl-4 text-sm text-muted-foreground">
                  <span>
                    <span className="font-medium text-foreground">{p.postsInWindow}</span> posts
                  </span>
                  <span>
                    last post <span className="font-medium text-foreground">{formatDays(p.daysSinceLastPost)}</span>{' '}
                    ago
                  </span>
                  {p.meanIntervalDays !== null ? (
                    <span>
                      every <span className="font-medium text-foreground">{formatDays(p.meanIntervalDays)}</span>
                    </span>
                  ) : null}
                  {p.followerCount !== null ? (
                    <span>
                      <span className="font-medium text-foreground">{formatCount(p.followerCount)}</span> followers
                    </span>
                  ) : null}
                  {p.avgEngagement !== null ? (
                    <span>
                      <span className="font-medium text-foreground">
                        {Math.round(p.avgEngagement * 10) / 10}
                      </span>{' '}
                      avg engagement
                    </span>
                  ) : null}
                </div>
                {p.windowTruncated ? (
                  <p className="pl-4 text-xs text-muted-foreground">
                    Sample capped — longest gaps are a lower bound.
                  </p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* 4) Findings */}
        {latest.findings.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Findings</CardTitle>
              <CardDescription>What the pull observed, per channel</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {latest.findings.map((finding, i) => (
                <div
                  key={`${finding.platform}-${finding.type}-${i}`}
                  className={`flex flex-col gap-0.5 rounded-lg border p-2.5 text-sm ${findingTone(finding)}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{platformLabel(finding.platform)}</span>
                    <span className="text-xs text-muted-foreground">
                      {finding.status === 'pass'
                        ? 'healthy'
                        : finding.status === 'fail'
                          ? 'needs attention'
                          : finding.status === 'error'
                            ? 'pull failed'
                            : 'not checked'}
                    </span>
                  </div>
                  <p className="text-muted-foreground">{finding.detail}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {/* 5) Deltas vs previous run */}
        {latest.deltas.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Since the previous pull</CardTitle>
              <CardDescription>
                {previousRun
                  ? `Compared against ${formatDate(previousRun.completedAt ?? previousRun.createdAt)}.`
                  : 'Movement since the previous completed pull.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-2 text-sm">
                {latest.deltas.slice(0, 10).map((d, i) => (
                  <div
                    key={`${d.platform}-${d.metric}-${i}`}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <dt className="text-muted-foreground">
                      {platformLabel(d.platform)} · {DELTA_LABEL[d.metric] ?? d.metric}
                    </dt>
                    <dd className="shrink-0">
                      <span className="text-muted-foreground">{formatDeltaValue(d.metric, d.previous)}</span>
                      <span className="text-muted-foreground"> → </span>
                      <span className="font-medium">{formatDeltaValue(d.metric, d.current)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        ) : null}

        {/* 6) Analyst narrative */}
        {latest.narrative ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Analyst notes</CardTitle>
            </CardHeader>
            <CardContent>
              <Narrative text={latest.narrative} />
            </CardContent>
          </Card>
        ) : null}

        {/* 7) Coverage notes + spend footnote */}
        {notes.length > 0 || ceilingHit || latest.totalCostUsd !== null ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Coverage notes</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 text-sm text-muted-foreground">
              {notes.map((finding, i) => (
                <p key={`${finding.platform}-${finding.type}-${i}`}>
                  {platformLabel(finding.platform)}: {finding.detail}
                </p>
              ))}
              {ceilingHit ? (
                <p>Some channels were skipped — this pull crossed its per-run spend ceiling.</p>
              ) : null}
              {latest.totalCostUsd !== null ? (
                <p>Pull spend ${latest.totalCostUsd.toFixed(3)} (actor usage, not the billed figure).</p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
