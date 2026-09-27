'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { GscOverview } from '@/types/google';
import { AreaChart, DeltaArrow } from './OrganicChart';

function pct(ratio: number | null): string {
  if (ratio === null) return '—';
  return `${(ratio * 100).toFixed(1)}%`;
}

export function GscDashboard({ overview }: { overview: GscOverview }) {
  const { totals, previousTotals } = overview;

  return (
    <div className="flex flex-col gap-4">
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

      <div className="grid gap-4 lg:grid-cols-2">
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top pages</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col p-0">
            {overview.byPage.length === 0 ? (
              <p className="px-6 py-4 text-sm text-muted-foreground">No page data in this period.</p>
            ) : (
              overview.byPage.map((row, i) => (
                <div
                  key={row.key}
                  className={`flex items-baseline justify-between gap-3 px-6 py-2.5 text-sm ${i > 0 ? 'border-t border-border' : ''}`}
                >
                  <p className="truncate" title={row.key}>
                    {row.key.replace(/^https?:\/\//, '').slice(0, 48)}
                  </p>
                  <p className="shrink-0 text-muted-foreground">
                    <span className="font-medium text-foreground">{row.clicks.toLocaleString()}</span> clicks ·{' '}
                    {pct(row.ctr)}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
