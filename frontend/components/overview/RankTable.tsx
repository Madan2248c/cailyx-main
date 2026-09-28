'use client';

import { ArrowDownRight, ArrowUpRight, ListOrdered } from 'lucide-react';
import { InlineEmpty, Section } from '@/components/portal/blocks';
import { formatDate, plural } from '@/components/portal/tone';
import type { SerpRankRow } from '@/lib/dataforseo-api';

function Delta({ delta, isNew }: { delta: number | null; isNew: boolean }) {
  if (isNew) return <span className="text-xs font-medium text-muted-foreground">New</span>;
  if (delta === null || delta === 0) return <span className="text-xs text-muted-foreground">No change</span>;
  if (delta > 0)
    return (
      <span aria-label={`Up ${delta} places`} className="inline-flex items-center gap-0.5 font-medium text-success">
        <ArrowUpRight aria-hidden className="size-3.5" />
        {delta}
      </span>
    );
  return (
    <span aria-label={`Down ${Math.abs(delta)} places`} className="inline-flex items-center gap-0.5 font-medium text-danger">
      <ArrowDownRight aria-hidden className="size-3.5" />
      {Math.abs(delta)}
    </span>
  );
}

function pathOf(url: string): string {
  try {
    const path = new URL(url).pathname;
    return path === '/' || path === '' ? 'Homepage' : path;
  } catch {
    return url;
  }
}

/** Where each tracked search puts you in Google, best position first. */
export function RankTable({
  rows,
  prevByKeyword,
  pulledAt,
  index = 0,
}: {
  rows: SerpRankRow[];
  prevByKeyword: Map<string, number>;
  pulledAt: string | null;
  index?: number;
}) {
  if (rows.length === 0) {
    return (
      <Section index={index} icon={ListOrdered} eyebrow="Your Google positions">
        <InlineEmpty>Your positions show up here after the first search check.</InlineEmpty>
      </Section>
    );
  }

  let climbers = 0;
  let fallers = 0;
  for (const row of rows) {
    const prev = prevByKeyword.get(row.keyword) ?? row.prevPosition ?? null;
    if (prev === null) continue;
    if (row.position < prev) climbers += 1;
    else if (row.position > prev) fallers += 1;
  }
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  const pageOne = rows.filter((r) => r.position <= 10).length;

  return (
    <Section
      index={index}
      icon={ListOrdered}
      eyebrow="Your Google positions"
      description={
        <>
          <span className="font-medium text-foreground">{pageOne}</span> of {plural(rows.length, 'search', 'searches')} on page one
          {climbers > 0 || fallers > 0 ? (
            <>
              {' · '}
              <span className="font-medium text-success">{climbers} up</span>,{' '}
              <span className="font-medium text-danger">{fallers} down</span>
            </>
          ) : null}
          {pulledAt ? ` · checked ${formatDate(pulledAt)}` : ''}
        </>
      }
      flush
    >
      <div className="overflow-x-auto">
        <table className="g-table min-w-[600px]">
          <thead>
            <tr>
              <th>Search</th>
              <th className="g-num-cell">Position</th>
              <th className="g-num-cell">Change</th>
              <th className="g-num-cell">Searches a month</th>
              <th>Your page</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const prev = prevByKeyword.get(row.keyword) ?? row.prevPosition ?? null;
              const delta = prev === null ? null : prev - row.position;
              return (
                <tr key={row.keyword}>
                  <td className="font-medium">{row.keyword}</td>
                  <td className="g-num-cell">
                    <span className={row.position <= 10 ? 'font-semibold' : 'text-muted-foreground'}>#{row.position}</span>
                  </td>
                  <td className="g-num-cell">
                    <Delta delta={delta} isNew={prev === null} />
                  </td>
                  <td className="g-num-cell text-muted-foreground">{row.volume.toLocaleString()}</td>
                  <td className="max-w-56 truncate text-muted-foreground" title={row.url}>
                    {pathOf(row.url)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
