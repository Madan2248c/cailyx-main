'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export interface SerpOption {
  id: string;
  keyword: string;
}

export interface SerpResult {
  position: number;
  url: string;
  title: string;
  features: string[];
}

/**
 * SERP snapshot viewer: keyword picker → top-10 results with position,
 * title, URL, and SERP-feature badges. Empty state when no serp-snapshot
 * data exists.
 */
export function SerpSnapshotViewer({
  options,
  selectedId,
  onSelect,
  results,
}: {
  options: SerpOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Null while the selected snapshot's detail is loading. */
  results: SerpResult[] | null;
}) {
  if (options.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">SERP snapshot</CardTitle>
          <CardDescription>Who actually ranks on page one for your keywords.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            No SERP snapshots yet — they appear here once the first data pull completes.
          </p>
        </CardContent>
      </Card>
    );
  }

  const top = (results ?? []).slice(0, 10);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">SERP snapshot</CardTitle>
            <CardDescription>Who actually ranks on page one for your keywords.</CardDescription>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Keyword</span>
            <select
              value={selectedId ?? ''}
              onChange={(event) => onSelect(event.target.value)}
              className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
            >
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.keyword}
                </option>
              ))}
            </select>
          </label>
        </div>
      </CardHeader>
      {results === null ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading snapshot…</p>
        </CardContent>
      ) : top.length === 0 ? (
        <CardContent>
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            This snapshot has no results.
          </p>
        </CardContent>
      ) : (
        <CardContent className="flex flex-col p-0">
          {top.map((result) => (
            <div
              key={`${result.position}-${result.url}`}
              className="flex items-start gap-3 border-t border-border px-6 py-2.5 text-sm first:border-t-0"
            >
              <p className="w-7 shrink-0 font-semibold text-muted-foreground">#{result.position}</p>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="truncate font-medium" title={result.title}>
                  {result.title || result.url}
                </p>
                <p className="truncate text-xs text-muted-foreground" title={result.url}>
                  {result.url}
                </p>
                {result.features.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {result.features.map((feature) => (
                      <Badge key={feature} variant="outline">
                        {feature}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
