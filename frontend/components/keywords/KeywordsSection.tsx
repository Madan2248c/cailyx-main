'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  coerceKeywordRow,
  getLatestSnapshot,
  keywordIdeasOf,
  keywordOverviewOf,
  type KeywordOverviewRow,
} from '@/lib/dataforseo-api';
import { PortalLoading } from '@/components/portal/states';

const WINNABLE_DIFFICULTY = 30;
const WINNABLE_VOLUME = 100;
const TABLE_LIMIT = 30;
const WINNABLE_LIMIT = 5;

function difficultyTone(difficulty: number): { text: string; bar: string } {
  if (!Number.isFinite(difficulty)) return { text: 'text-muted-foreground', bar: 'bg-muted-foreground' };
  if (difficulty <= WINNABLE_DIFFICULTY) return { text: 'text-success', bar: 'bg-success' };
  if (difficulty <= 60) return { text: 'text-warning', bar: 'bg-warning' };
  return { text: 'text-danger', bar: 'bg-danger' };
}

function formatCpc(cpc: number): string {
  return Number.isFinite(cpc) && cpc > 0 ? `$${cpc.toFixed(2)}` : '—';
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function KeywordsSection({
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
  const [keywords, setKeywords] = useState<KeywordOverviewRow[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      getLatestSnapshot(accessToken, clientId, projectId, 'keyword-overview'),
      getLatestSnapshot(accessToken, clientId, projectId, 'keyword-ideas'),
    ])
      .then(([overviewSnap, ideasSnap]) => {
        if (cancelled) return;
        // Merge both datasets (either may be absent) and dedupe by keyword,
        // keeping the highest-volume reading.
        const merged = new Map<string, KeywordOverviewRow>();
        for (const row of keywordOverviewOf(overviewSnap)) {
          const coerced = coerceKeywordRow(row);
          if (coerced) merged.set(coerced.keyword, coerced);
        }
        for (const idea of keywordIdeasOf(ideasSnap)) {
          const coerced = coerceKeywordRow(idea);
          if (!coerced) continue;
          const existing = merged.get(coerced.keyword);
          if (!existing || coerced.volume > existing.volume) merged.set(coerced.keyword, coerced);
        }
        const sorted = [...merged.values()].sort((a, b) => b.volume - a.volume);
        if (!cancelled) {
          setKeywords(sorted);
          setState('ready');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load keywords');
          setState('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, projectId]);

  if (state === 'loading') {
    return <PortalLoading label="Loading keywords" />;
  }

  if (state === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!keywords) return null;

  // Empty state: keyword datasets land in parallel with the rest, so absence
  // is expected before the first pull.
  if (keywords.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
        <div>
          <h1 className="text-2xl font-semibold">Keywords</h1>
          <p className="text-sm text-muted-foreground">{projectName}</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              No keyword data yet. Ideas and difficulty scores appear here automatically once the
              first keyword pull runs for this project — check back soon.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const winnable = keywords
    .filter((row) => row.difficulty <= WINNABLE_DIFFICULTY && row.volume >= WINNABLE_VOLUME)
    .slice(0, WINNABLE_LIMIT);
  const totalVolume = keywords.reduce((sum, row) => sum + (Number.isFinite(row.volume) ? row.volume : 0), 0);
  const avgDifficulty =
    keywords.length > 0
      ? keywords.reduce((sum, row) => sum + (Number.isFinite(row.difficulty) ? row.difficulty : 0), 0) /
        keywords.length
      : 0;

  const visible = keywords.slice(0, TABLE_LIMIT);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Keywords</h1>
        <p className="text-sm text-muted-foreground">
          {projectName} · {keywords.length} {keywords.length === 1 ? 'keyword' : 'keywords'} tracked
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Keywords tracked</p>
            <p className="text-4xl font-semibold">{keywords.length}</p>
            <p className="text-xs text-muted-foreground">across overview and ideas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Combined volume</p>
            <p className="text-4xl font-semibold">{totalVolume.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">monthly searches up for grabs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Winnable now</p>
            <p className="text-4xl font-semibold text-success">
              {keywords.filter((row) => row.difficulty <= WINNABLE_DIFFICULTY && row.volume >= WINNABLE_VOLUME).length}
            </p>
            <p className="text-xs text-muted-foreground">
              difficulty ≤ {WINNABLE_DIFFICULTY} · volume ≥ {WINNABLE_VOLUME} · avg difficulty{' '}
              {avgDifficulty.toFixed(0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {winnable.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Winnable keywords</CardTitle>
            <CardDescription>
              Low difficulty plus decent volume — target these first
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <ul className="flex flex-col gap-2">
              {winnable.map((row) => (
                <li
                  key={row.keyword}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <p className="min-w-0 flex-1 truncate font-medium">“{row.keyword}”</p>
                  <p className="shrink-0 text-muted-foreground">
                    {row.volume.toLocaleString()} searches · difficulty {row.difficulty}
                  </p>
                  <Badge variant="secondary" className="shrink-0 text-success">
                    WINNABLE
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Winnable keywords</CardTitle>
            <CardDescription>Low difficulty plus decent volume</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Nothing clears the winnable bar right now (difficulty ≤ {WINNABLE_DIFFICULTY}, volume ≥{' '}
              {WINNABLE_VOLUME}). The easiest wins are the lowest-difficulty rows in the table below.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All keywords</CardTitle>
          <CardDescription>Sorted by search volume, highest first</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col overflow-x-auto p-0">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-6 py-2.5 font-medium">Keyword</th>
                <th className="px-4 py-2.5 font-medium">Volume</th>
                <th className="px-4 py-2.5 font-medium">Difficulty</th>
                <th className="px-6 py-2.5 font-medium">CPC</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const tone = difficultyTone(row.difficulty);
                const isWinnable =
                  row.difficulty <= WINNABLE_DIFFICULTY && row.volume >= WINNABLE_VOLUME;
                return (
                  <tr key={row.keyword} className="border-t border-border align-top">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{row.keyword}</p>
                        {isWinnable ? (
                          <Badge variant="secondary" className="shrink-0 text-success">
                            WINNABLE
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">{row.volume.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex min-w-28 flex-col gap-1">
                        <p className={`font-semibold ${tone.text}`}>{row.difficulty}</p>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full ${tone.bar}`}
                            style={{ width: `${clampPercent(row.difficulty)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">{formatCpc(row.cpc)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {keywords.length > visible.length ? (
            <p className="px-6 py-3 text-xs text-muted-foreground">
              + {keywords.length - visible.length} more keywords in this pull.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
