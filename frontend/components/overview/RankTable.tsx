'use client';

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { SerpRankRow } from '@/lib/dataforseo-api';

function formatDate(iso: string | null): string {
  if (!iso) return 'the last pull';
  return new Date(iso).toLocaleDateString();
}

function Delta({ delta, isNew }: { delta: number | null; isNew: boolean }) {
  if (isNew) return <span className="font-medium text-muted-foreground">new</span>;
  if (delta === null || delta === 0)
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Minus aria-hidden="true" className="size-3.5" />
        <span aria-hidden="true">—</span>
        <span className="sr-only">No change</span>
      </span>
    );
  if (delta > 0)
    return (
      <span
        aria-label={`Up ${delta} positions (improved)`}
        className="inline-flex items-center gap-1 font-medium text-success"
      >
        <ArrowUpRight aria-hidden="true" className="size-3.5" />
        {delta}
        <span className="sr-only">(improved)</span>
      </span>
    );
  return (
    <span
      aria-label={`Down ${Math.abs(delta)} positions (falling)`}
      className="inline-flex items-center gap-1 font-medium text-danger"
    >
      <ArrowDownRight aria-hidden="true" className="size-3.5" />
      {Math.abs(delta)}
      <span className="sr-only">(falling)</span>
    </span>
  );
}

/**
 * Rank tracking table (insights first: climbers/fallers summary line, then
 * the full keyword table). Empty state when no serp-ranks snapshot exists.
 */
export function RankTable({
  rows,
  prevByKeyword,
  pulledAt,
}: {
  rows: SerpRankRow[];
  prevByKeyword: Map<string, number>;
  pulledAt: string | null;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rank tracking</CardTitle>
          <CardDescription>Where your keywords sit in Google right now.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            No rank tracking data yet — it appears here once the first data pull completes.
          </p>
        </CardContent>
      </Card>
    );
  }

  let climbers = 0;
  let fallers = 0;
  let fresh = 0;
  for (const row of rows) {
    const prev = prevByKeyword.get(row.keyword) ?? row.prevPosition ?? null;
    if (prev === null) fresh += 1;
    else if (row.position < prev) climbers += 1;
    else if (row.position > prev) fallers += 1;
  }

  const sorted = [...rows].sort((a, b) => a.position - b.position);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Rank tracking</CardTitle>
        <CardDescription>
          {rows.length} keyword{rows.length === 1 ? '' : 's'} tracked since {formatDate(pulledAt)}
          {climbers > 0 || fallers > 0 || fresh > 0
            ? ` — ${climbers} climbing, ${fallers} falling${fresh > 0 ? `, ${fresh} new` : ''}.`
            : ' — no movement.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col p-0">
        <div className="hidden grid-cols-[1fr_5rem_5rem_6rem_minmax(0,1.5fr)] gap-3 border-b border-border px-6 pb-2 text-xs font-medium text-muted-foreground sm:grid">
          <p>Keyword</p>
          <p className="text-right">Position</p>
          <p className="text-right">Change</p>
          <p className="text-right">Volume</p>
          <p>Ranking URL</p>
        </div>
        {sorted.map((row) => {
          const prev = prevByKeyword.get(row.keyword) ?? row.prevPosition ?? null;
          const delta = prev === null ? null : prev - row.position;
          return (
            <div
              key={row.keyword}
              className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-b border-border px-6 py-2.5 text-sm last:border-b-0 sm:grid-cols-[1fr_5rem_5rem_6rem_minmax(0,1.5fr)] sm:items-baseline"
            >
              <p className="font-medium">{row.keyword}</p>
              <p className="text-right font-semibold sm:order-none">#{row.position}</p>
              <p className="text-right">
                <Delta delta={delta} isNew={prev === null} />
              </p>
              <p className="text-right text-muted-foreground">{row.volume.toLocaleString()}</p>
              <p
                className="col-span-2 truncate text-muted-foreground sm:col-span-1"
                title={row.url}
                aria-label={`Ranking URL: ${row.url}`}
              >
                {row.url}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
