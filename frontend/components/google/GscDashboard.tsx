'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { GscOverview } from '@/types/google';
import { AreaChart, DeltaArrow } from './OrganicChart';

function pct(ratio: number | null): string {
  if (ratio === null) return '—';
  return `${(ratio * 100).toFixed(1)}%`;
}

export function GscKpis({ overview }: { overview: GscOverview }) {
  const { totals, previousTotals } = overview;
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Card>
        <CardContent className="flex flex-col gap-1 pt-5">
          <p className="text-xs font-medium text-muted-foreground">Clicks</p>
          <p className="text-3xl font-semibold">{totals.clicks.toLocaleString()}</p>
          <div className="text-xs">
            <DeltaArrow current={totals.clicks} previous={previousTotals.clicks} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-1 pt-5">
          <p className="text-xs font-medium text-muted-foreground">Impressions</p>
          <p className="text-3xl font-semibold">{totals.impressions.toLocaleString()}</p>
          <div className="text-xs">
            <DeltaArrow current={totals.impressions} previous={previousTotals.impressions} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-1 pt-5">
          <p className="text-xs font-medium text-muted-foreground">Avg CTR</p>
          <p className="text-3xl font-semibold">{pct(totals.ctr)}</p>
          <div className="text-xs">
            <DeltaArrow current={totals.ctr} previous={previousTotals.ctr} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-1 pt-5">
          <p className="text-xs font-medium text-muted-foreground">Avg position</p>
          <p className="text-3xl font-semibold">
            {totals.position !== null ? totals.position.toFixed(1) : '—'}
          </p>
          <div className="text-xs">
            <DeltaArrow current={totals.position} previous={previousTotals.position} invert />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function GscClicksChart({ overview }: { overview: GscOverview }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Clicks over time</CardTitle>
        <CardDescription>
          {overview.siteUrl} · last {overview.days} days
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AreaChart
          values={overview.byDate.map((d) => d.clicks)}
          labels={overview.byDate.map((d) => d.date)}
          ariaLabel="Daily clicks"
        />
      </CardContent>
    </Card>
  );
}

export function IndexCoverage({ overview }: { overview: GscOverview }) {
  const coverage = overview.indexCoverage;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Index coverage</CardTitle>
        <CardDescription>Submitted vs indexed across your sitemaps</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!coverage ? (
          <p className="text-sm text-muted-foreground">No sitemaps listed on this property.</p>
        ) : (
          <>
            <div className="flex items-baseline gap-6">
              <p>
                <span className={`text-3xl font-semibold ${coverage.notIndexed > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                  {coverage.notIndexed.toLocaleString()}
                </span>{' '}
                <span className="text-sm text-muted-foreground">not indexed</span>
              </p>
              <p className="text-sm text-muted-foreground">
                {coverage.indexed.toLocaleString()} of {coverage.submitted.toLocaleString()} submitted
              </p>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-green-500"
                style={{ width: `${coverage.submitted > 0 ? Math.round((coverage.indexed / coverage.submitted) * 100) : 0}%` }}
              />
            </div>
            {coverage.sitemaps.map((s) => (
              <div key={s.path} className="flex items-baseline justify-between gap-3 text-sm">
                <p className="truncate text-muted-foreground" title={s.path}>
                  {s.path.replace(/^https?:\/\//, '').slice(0, 44)}
                </p>
                <p className="shrink-0">
                  {s.indexed.toLocaleString()}/{s.submitted.toLocaleString()}
                </p>
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function GscTopQueries({ overview }: { overview: GscOverview }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Top queries</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col p-0">
        {overview.byQuery.length === 0 ? (
          <p className="px-6 py-4 text-sm text-muted-foreground">No query data in this period.</p>
        ) : (
          overview.byQuery.map((row, i) => (
            <div
              key={row.key}
              className={`flex items-baseline justify-between gap-3 px-6 py-2.5 text-sm ${i > 0 ? 'border-t border-border' : ''}`}
            >
              <p className="truncate">{row.key}</p>
              <p className="shrink-0 text-muted-foreground">
                <span className="font-medium text-foreground">{row.clicks.toLocaleString()}</span> clicks · #{row.position.toFixed(1)}
              </p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
