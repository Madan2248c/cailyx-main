'use client';

import { useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { Section } from '@/components/portal/blocks';
import { StatusChip } from '@/components/portal/layout';
import { getSnapshot, listSnapshots, type DataforseoSnapshot, type SerpRankRow } from '@/lib/dataforseo-api';

type MoverKind = 'climber' | 'faller' | 'new' | 'lost';

interface Mover {
  keyword: string;
  kind: MoverKind;
  position: number | null;
  prev: number | null;
  /** Positive when the keyword climbed (prev - position). Null for new/lost. */
  delta: number | null;
  line: string;
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

/**
 * Latest vs previous snapshot per keyword (insights first: growth, not raw
 * dumps). Cross-snapshot positions win; a row's embedded prevPosition covers
 * keywords missing from the previous pull and single-snapshot histories.
 */
export function compareRankSnapshots(latest: SerpRankRow[], previous: SerpRankRow[]): Mover[] {
  const prevByKeyword = new Map(previous.map((row) => [row.keyword, row]));
  const movers: Mover[] = [];

  for (const row of latest) {
    const prevRow = prevByKeyword.get(row.keyword);
    const prev = prevRow?.position ?? row.prevPosition ?? null;
    if (prev === null) {
      movers.push({
        keyword: row.keyword,
        kind: 'new',
        position: row.position,
        prev: null,
        delta: null,
        line: `“${row.keyword}” now shows up at #${row.position}.`,
      });
    } else if (row.position < prev) {
      const delta = prev - row.position;
      movers.push({
        keyword: row.keyword,
        kind: 'climber',
        position: row.position,
        prev,
        delta,
        line: `“${row.keyword}” moved up from #${prev} to #${row.position}.`,
      });
    } else if (row.position > prev) {
      const delta = prev - row.position;
      movers.push({
        keyword: row.keyword,
        kind: 'faller',
        position: row.position,
        prev,
        delta,
        line: `“${row.keyword}” slipped from #${prev} to #${row.position}.`,
      });
    }
  }

  const latestKeywords = new Set(latest.map((row) => row.keyword));
  for (const row of previous) {
    if (!latestKeywords.has(row.keyword)) {
      movers.push({
        keyword: row.keyword,
        kind: 'lost',
        position: null,
        prev: row.position,
        delta: null,
        line: `“${row.keyword}” dropped out of the results (was #${row.position}).`,
      });
    }
  }

  return movers;
}

const KIND_ORDER: Record<MoverKind, number> = { climber: 0, new: 1, faller: 2, lost: 3 };

export function RankMovement({
  accessToken,
  clientId,
  projectId,
}: {
  accessToken: string;
  clientId: string;
  projectId: string;
}) {
  const [movers, setMovers] = useState<Mover[] | null>(null);
  const [period, setPeriod] = useState<{ latest: string; previous: string | null } | null>(null);

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
        const moversResult = compareRankSnapshots(latestRows, rankingsOf(previous));
        if (!cancelled) {
          setMovers(moversResult);
          setPeriod({
            latest: latest.createdAt,
            previous: previous?.createdAt ?? null,
          });
        }
      })
      .catch(() => {
        // No rank history to show: the section omits itself rather than
        // breaking the Competitors tab.
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, projectId]);

  // Gracefully omit: still loading, fetch failed, or no snapshots exist.
  if (!movers || !period) return null;

  const climbers = movers.filter((m) => m.kind === 'climber');
  const fallers = movers.filter((m) => m.kind === 'faller');
  const fresh = movers.filter((m) => m.kind === 'new');
  const lost = movers.filter((m) => m.kind === 'lost');

  const parts: string[] = [];
  if (climbers.length > 0) parts.push(`${climbers.length} moved up`);
  if (fresh.length > 0) parts.push(`${fresh.length} newly showing`);
  if (fallers.length > 0) parts.push(`${fallers.length} slipped`);
  if (lost.length > 0) parts.push(`${lost.length} dropped out`);
  const since = formatDate(period.previous ?? period.latest);
  const summary =
    parts.length > 0 ? `Since ${since}: ${parts.join(', ')}.` : `No changes in your Google positions since ${since}.`;

  const ordered = [...movers].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (b.delta ?? 0) - (a.delta ?? 0),
  );
  const visible = ordered.slice(0, 8);

  return (
    <Section icon={TrendingUp} eyebrow="Your Google positions" description={summary}>
      {visible.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {visible.map((mover) => (
            <li key={`${mover.kind}-${mover.keyword}`} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <p className="min-w-0 flex-1">{mover.line}</p>
              {mover.kind === 'climber' ? (
                <StatusChip tone="good">▲ {mover.delta}</StatusChip>
              ) : mover.kind === 'faller' ? (
                <StatusChip tone="bad">▼ {mover.prev !== null && mover.position !== null ? mover.position - mover.prev : 0}</StatusChip>
              ) : mover.kind === 'new' ? (
                <StatusChip tone="neutral">New</StatusChip>
              ) : (
                <StatusChip tone="bad">Dropped</StatusChip>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {movers.length > visible.length ? (
        <p className="mt-2 text-xs text-muted-foreground">Showing {visible.length} of {movers.length} changes.</p>
      ) : null}
    </Section>
  );
}
