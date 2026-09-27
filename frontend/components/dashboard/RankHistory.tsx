'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { getSnapshot, listSnapshots, type DataforseoSnapshot, type SerpRankRow } from '@/lib/dataforseo-api';

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
  if (!iso) return 'the last pull';
  return new Date(iso).toLocaleDateString();
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
  return `“${mover.keyword}” lost (was #${mover.prev ?? '—'})`;
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
    <Card>
      <CardContent className="flex flex-col gap-1 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          <span className="font-medium">Rank history:</span> {movers.length} keyword{movers.length === 1 ? '' : 's'} moved
          since {formatDate(since)}
          {climbers > 0 ? ` — ${climbers} climbing` : ''} · {top.map(shortLabel).join(' · ')}
        </p>
        <Link
          href={`/client/projects/${projectId}/competitors`}
          className="shrink-0 text-sm font-medium text-primary hover:underline"
        >
          See rank movement →
        </Link>
      </CardContent>
    </Card>
  );
}
