'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, TrendingUp } from 'lucide-react';
import { getSnapshot, listSnapshots, type DataforseoSnapshot, type SerpRankRow } from '@/lib/dataforseo-api';
import { useProjectBase } from '@/components/portal/routes';

interface TopMover {
  keyword: string;
  kind: 'climber' | 'faller' | 'new' | 'lost';
  position: number | null;
  prev: number | null;
  delta: number | null;
}

function rankingsOf(snapshot: DataforseoSnapshot | null | undefined): SerpRankRow[] {
  if (!snapshot || typeof snapshot.payload !== 'object' || snapshot.payload === null) return [];
  const payload = snapshot.payload as { dataset?: unknown; rankings?: unknown };
  if (payload.dataset !== 'serp-ranks' || !Array.isArray(payload.rankings)) return [];
  return payload.rankings.filter(
    (row): row is SerpRankRow =>
      typeof row === 'object' &&
      row !== null &&
      typeof (row as { keyword?: unknown }).keyword === 'string' &&
      typeof (row as { position?: unknown }).position === 'number' &&
      Number.isFinite((row as { position: number }).position),
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'the last check';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function shortLabel(mover: TopMover): string {
  if (mover.kind === 'climber' && mover.delta !== null && mover.position !== null) {
    return `“${mover.keyword}” ▲${mover.delta} to #${mover.position}`;
  }
  if (mover.kind === 'faller' && mover.prev !== null && mover.position !== null) {
    return `“${mover.keyword}” ▼${mover.position - mover.prev} to #${mover.position}`;
  }
  if (mover.kind === 'new' && mover.position !== null) {
    return `“${mover.keyword}” new at #${mover.position}`;
  }
  return `“${mover.keyword}” dropped out (was #${mover.prev ?? '?'})`;
}

/**
 * Rank-history strip: latest serp-ranks movers count + top 3 movers linking
 * to the Competitors tab. Omits itself silently when there is nothing to
 * show — loading, failed, empty, or no movement.
 */
export function RankHistory({
  accessToken,
  clientId,
  projectId,
}: {
  accessToken: string;
  clientId: string;
  projectId: string;
}) {
  const projectBase = useProjectBase(projectId);
  const [movers, setMovers] = useState<TopMover[] | null>(null);
  const [since, setSince] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    listSnapshots(accessToken, clientId, projectId, 'serp-ranks')
      .then((snapshots) => {
        if (snapshots.length === 0) return null;
        const latestId = snapshots[0].id;
        const previousId = snapshots.length > 1 ? snapshots[1].id : null;
        return Promise.all([
          getSnapshot(accessToken, clientId, latestId),
          previousId ? getSnapshot(accessToken, clientId, previousId) : Promise.resolve(null),
        ]);
      })
      .then((pair) => {
        if (cancelled || !pair) return;
        const [latest, previous] = pair;
        if (!latest) return;
        const latestRows = rankingsOf(latest);
        if (latestRows.length === 0) return;
        const prevByKeyword = new Map(rankingsOf(previous).map((row) => [row.keyword, row]));
        const result: TopMover[] = [];

        for (const row of latestRows) {
          const prev = prevByKeyword.get(row.keyword)?.position ?? row.prevPosition ?? null;
          if (prev === null) {
            result.push({ keyword: row.keyword, kind: 'new', position: row.position, prev: null, delta: null });
          } else if (row.position !== prev) {
            result.push({
              keyword: row.keyword,
              kind: row.position < prev ? 'climber' : 'faller',
              position: row.position,
              prev,
              delta: prev - row.position,
            });
          }
        }

        const latestKeywords = new Set(latestRows.map((row) => row.keyword));
        for (const row of rankingsOf(previous)) {
          if (!latestKeywords.has(row.keyword)) {
            result.push({ keyword: row.keyword, kind: 'lost', position: null, prev: row.position, delta: null });
          }
        }

        if (!cancelled) {
          setMovers(result);
          setSince(previous?.createdAt ?? latest.createdAt);
        }
      })
      .catch(() => {
        // Nothing to show — the strip omits itself rather than breaking the dashboard.
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, projectId]);

  // Omit silently: loading, failed, empty, or no movement.
  if (!movers || !since || movers.length === 0) return null;

  const weight = (m: TopMover) => (m.delta === null ? 1000 : Math.abs(m.delta));
  const top = [...movers].sort((a, b) => weight(b) - weight(a)).slice(0, 3);
  const climbers = movers.filter((m) => m.kind === 'climber').length;

  return (
    <Link href={`${projectBase}/competitors`} className="g-tile g-rise flex flex-col gap-3 p-5" style={{ '--i': 8 } as React.CSSProperties}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="size-3.5 opacity-70" />
            <p className="g-eyebrow">Google search movement</p>
          </div>
          <p className="text-sm text-muted-foreground">
            {movers.length} keyword{movers.length === 1 ? '' : 's'} moved since {formatDate(since)}
            {climbers > 0 ? `, ${climbers} climbing` : ''}
          </p>
        </div>
        <ArrowUpRight className="g-row-arrow size-4 shrink-0 opacity-50" />
      </div>
      <ul className="grid gap-2 sm:grid-cols-3">
        {top.map((m) => {
          const up = m.kind === 'climber' || m.kind === 'new';
          return (
            <li key={m.keyword} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
              <span className={`size-1.5 shrink-0 rounded-full ${up ? 'bg-success' : 'bg-danger'}`} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{shortLabel(m)}</span>
            </li>
          );
        })}
      </ul>
    </Link>
  );
}
