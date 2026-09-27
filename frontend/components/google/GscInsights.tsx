'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { GscOverview, PageInsight } from '@/types/google';

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').slice(0, 52);
}

function MiniSpark({ points }: { points: number[] }) {
  if (points.length < 2) return <span className="text-xs text-muted-foreground">—</span>;
  const width = 80;
  const height = 24;
  const max = Math.max(...points, 1);
  const coords = points.map((v, i) => {
    const x = (i / (points.length - 1)) * (width - 4) + 2;
    const y = height - 3 - (v / max) * (height - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} role="img" aria-label="Click trend">
      <polyline points={coords.join(' ')} fill="none" strokeWidth="1.5" className="stroke-primary" />
    </svg>
  );
}

function InsightRow({ insight }: { insight: PageInsight }) {
  return (
    <div className="flex flex-col gap-0.5 px-6 py-2.5 text-sm">
      <p className="truncate font-medium" title={insight.url}>
        {shortUrl(insight.url)}
      </p>
      {insight.action ? <p className="text-muted-foreground">{insight.action}</p> : null}
    </div>
  );
}

/** Period-over-period page intelligence — the value over raw Search Console. */
export function GscInsights({ overview }: { overview: GscOverview }) {
  const wins = overview.pageInsights.filter((i) => i.actionLevel === 'win' && i.action);
  const attention = overview.pageInsights.filter(
    (i) => (i.actionLevel === 'act' || i.actionLevel === 'watch') && i.action,
  );
  const best = [...overview.pageInsights].sort((a, b) => b.clicks - a.clicks).slice(0, 8);
  const pageOne = overview.pageInsights.filter((i) => i.onPageOne).sort((a, b) => a.position - b.position);

  const trendByUrl = new Map<string, number[]>();
  for (const row of overview.pageTrends) {
    const list = trendByUrl.get(row.url) ?? [];
    list.push(row.clicks);
    trendByUrl.set(row.url, list);
  }

  if (wins.length === 0 && attention.length === 0 && best.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Wins</CardTitle>
            <CardDescription>Pages climbing or new on page one</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border p-0">
            {wins.length === 0 ? (
              <p className="px-6 py-4 text-sm text-muted-foreground">No wins in this period.</p>
            ) : (
              wins.slice(0, 6).map((i) => <InsightRow key={i.url} insight={i} />)
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Needs attention</CardTitle>
            <CardDescription>Slipping or fading pages, with what to do</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border p-0">
            {attention.length === 0 ? (
              <p className="px-6 py-4 text-sm text-muted-foreground">Nothing needs attention.</p>
            ) : (
              attention.slice(0, 6).map((i) => <InsightRow key={i.url} insight={i} />)
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Best pages</CardTitle>
            <CardDescription>By clicks, with each page&apos;s trend</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col p-0">
            {best.map((i, idx) => (
              <div
                key={i.url}
                className={`flex items-center gap-3 px-6 py-2.5 text-sm ${idx > 0 ? 'border-t border-border' : ''}`}
              >
                <p className="min-w-0 flex-1 truncate" title={i.url}>
                  {shortUrl(i.url)}
                </p>
                <MiniSpark points={trendByUrl.get(i.url) ?? []} />
                <p className="shrink-0 text-muted-foreground">
                  <span className="font-medium text-foreground">{i.clicks.toLocaleString()}</span> · #{i.position.toFixed(1)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">On page one</CardTitle>
            <CardDescription>{pageOne.length} pages ranking in the top 10</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col p-0">
            {pageOne.length === 0 ? (
              <p className="px-6 py-4 text-sm text-muted-foreground">No pages on page one yet.</p>
            ) : (
              pageOne.slice(0, 10).map((i, idx) => (
                <div
                  key={i.url}
                  className={`flex items-center gap-3 px-6 py-2.5 text-sm ${idx > 0 ? 'border-t border-border' : ''}`}
                >
                  <Badge variant="secondary">#{Math.round(i.position)}</Badge>
                  <p className="min-w-0 flex-1 truncate" title={i.url}>
                    {shortUrl(i.url)}
                  </p>
                  <p className="shrink-0 text-muted-foreground">{i.clicks.toLocaleString()} clicks</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
