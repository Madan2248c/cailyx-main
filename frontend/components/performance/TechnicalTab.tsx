'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getTechnicalAuditTrend, listTechnicalAuditRuns } from '@/lib/technical-api';
import type { AuditStatus, TechnicalAuditRun, TrendPoint } from '@/types/technical';
import { CHECK_LABEL, CHECK_ORDER } from '@/types/technical';

const STATUS_VARIANT: Record<AuditStatus, 'secondary' | 'destructive' | 'outline' | 'ghost'> = {
  pass: 'secondary',
  fail: 'destructive',
  error: 'outline',
  'not-run': 'ghost',
};

const STATUS_LABEL: Record<AuditStatus, string> = {
  pass: 'Pass',
  fail: 'Fail',
  error: 'Check error',
  'not-run': 'Not assessed',
};

function scoreTone(score: number | null): { text: string; bar: string } {
  if (score === null) return { text: 'text-muted-foreground', bar: 'bg-muted-foreground' };
  if (score >= 80) return { text: 'text-green-600', bar: 'bg-green-500' };
  if (score >= 50) return { text: 'text-amber-600', bar: 'bg-amber-500' };
  return { text: 'text-red-600', bar: 'bg-red-500' };
}

function TrendSparkline({ trend }: { trend: TrendPoint[] }) {
  const points = trend.filter((t) => t.score !== null);
  if (points.length < 2) return null;
  const width = 160;
  const height = 48;
  const coords = points.map((t, i) => {
    const x = (i / (points.length - 1)) * (width - 8) + 4;
    const y = height - 4 - ((t.score ?? 0) / 100) * (height - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = points[points.length - 1];
  const [lx, ly] = coords[coords.length - 1].split(',').map(Number);
  return (
    <svg width={width} height={height} role="img" aria-label={`Score trend, latest ${last.score}`} className="w-full">
      <polyline points={coords.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary" />
      <circle cx={lx} cy={ly} r="3" className="fill-primary" />
    </svg>
  );
}

export function TechnicalTab({
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
  const [runs, setRuns] = useState<TechnicalAuditRun[] | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      listTechnicalAuditRuns(accessToken, clientId, projectId),
      getTechnicalAuditTrend(accessToken, clientId, projectId).catch(() => [] as TrendPoint[]),
    ])
      .then(([runList, trendPoints]) => {
        if (!cancelled) {
          setRuns(runList);
          setTrend(trendPoints);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load the audit');
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
        <p className="text-sm text-muted-foreground">Loading technical audit…</p>
      </div>
    );
  }

  const latest = runs.find((r) => r.status === 'COMPLETE') ?? null;
  const pending = runs.find((r) => r.status === 'QUEUED' || r.status === 'RUNNING') ?? null;

  if (!latest) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8">
        <h1 className="text-2xl font-semibold">Technical</h1>
        <p className="mt-1 text-sm text-muted-foreground">{projectName}</p>
        <Card className="mt-4">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {pending
                ? 'An audit is running right now — check back when it completes.'
                : 'No completed audit yet. One runs automatically as part of your Day-1 pipeline.'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const findingsByType = new Map(latest.findings.map((f) => [f.type, f]));
  const failing = latest.findings.filter((f) => f.status === 'fail');
  const passing = latest.findings.filter((f) => f.status === 'pass').length;
  const movers = latest.deltas.filter((d) => d.change !== null && d.change !== 0 && d.direction !== 'unchanged');
  const tone = scoreTone(latest.score);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Technical</h1>
          <p className="text-sm text-muted-foreground">
            {projectName} · audited {new Date(latest.completedAt ?? latest.createdAt).toLocaleDateString()}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {trend.length > 1 ? `Audit ${trend.length} of ${trend.length}` : 'First audit'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="flex flex-col gap-2 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Site score</p>
            <p className={`text-4xl font-semibold ${tone.text}`}>
              {latest.score ?? '—'}
              <span className="text-base font-normal text-muted-foreground">/100</span>
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${latest.score ?? 0}%` }} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-2 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Failing checks</p>
            <p className={`text-4xl font-semibold ${failing.length > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {failing.length}
              <span className="text-base font-normal text-muted-foreground">/8</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {failing.length === 0 ? 'All checks passing' : 'Needs attention'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-2 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Checks passing</p>
            <p className="text-4xl font-semibold">
              {passing}
              <span className="text-base font-normal text-muted-foreground">/8</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {latest.findings.length < 8 ? 'Some checks not assessed' : 'Full coverage'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-2 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Trend</p>
            {trend.length > 1 ? (
              <TrendSparkline trend={trend} />
            ) : (
              <p className="text-sm text-muted-foreground">Needs a second audit to draw.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Checks</CardTitle>
            <CardDescription>Expand a failing check for the recommended fix.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {CHECK_ORDER.map((type) => {
              const finding = findingsByType.get(type);
              const status = finding?.status ?? 'not-run';
              return (
                <details key={type} className="group rounded-lg border border-border" open={status === 'fail'}>
                  <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                    <span className={`size-2 shrink-0 rounded-full ${status === 'pass' ? 'bg-green-500' : status === 'fail' ? 'bg-red-500' : status === 'error' ? 'bg-amber-500' : 'bg-muted-foreground/40'}`} />
                    <span className="text-sm font-medium">{CHECK_LABEL[type]}</span>
                    <Badge variant={STATUS_VARIANT[status]} className="ml-auto">
                      {STATUS_LABEL[status]}
                    </Badge>
                  </summary>
                  <div className="flex flex-col gap-1 border-t border-border px-3 py-2.5 text-sm">
                    {finding ? (
                      <>
                        <p className="text-xs text-muted-foreground">
                          Severity: {finding.severity} · {finding.confidence}
                        </p>
                        <p>{finding.recommendedFix}</p>
                      </>
                    ) : (
                      <p className="text-muted-foreground">This check did not run in the latest audit.</p>
                    )}
                  </div>
                </details>
              );
            })}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4 lg:col-span-2">
          {latest.narrative ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-line">{latest.narrative}</p>
              </CardContent>
            </Card>
          ) : null}

          {movers.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Since the last audit</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-2 text-sm">
                  {movers.slice(0, 8).map((d) => (
                    <div key={d.metric} className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">{d.label}</dt>
                      <dd className="flex shrink-0 items-baseline gap-1.5">
                        <span className="text-muted-foreground">
                          {d.previous ?? '—'} → {d.current ?? '—'}
                        </span>
                        <span
                          className={
                            d.direction === 'improved'
                              ? 'font-medium text-green-600'
                              : d.direction === 'regressed'
                                ? 'font-medium text-red-600'
                                : 'text-muted-foreground'
                          }
                        >
                          {d.direction === 'improved' ? '▲' : d.direction === 'regressed' ? '▼' : '●'}
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
