'use client';

import { Search } from '@/components/animate-ui/icons/search';
import { AutoHeight } from '@/components/animate-ui/primitives/effects/auto-height';
import { InlineEmpty, Section } from '@/components/portal/blocks';

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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Google's first page for one search: who actually shows up, in order.
 * Hidden entirely until at least one search has been captured.
 */
export function SerpSnapshotViewer({
  options,
  selectedId,
  onSelect,
  results,
  index = 0,
}: {
  options: SerpOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Null while the selected search's results are loading. */
  results: SerpResult[] | null;
  index?: number;
}) {
  if (options.length === 0) return null;

  const top = (results ?? []).slice(0, 10);

  return (
    <Section
      index={index}
      icon={Search}
      eyebrow="Google's first page"
      description="Who shows up first when buyers make this search."
      right={
        options.length > 1 ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Search</span>
            <select
              value={selectedId ?? ''}
              onChange={(event) => onSelect(event.target.value)}
              className="h-8 max-w-56 truncate rounded-lg border border-border bg-background px-2 text-sm"
            >
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.keyword}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="text-sm font-medium">“{options[0].keyword}”</span>
        )
      }
      flush
    >
      <AutoHeight deps={[selectedId, results]}>
      {results === null ? (
        <div className="px-5 pb-5">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      ) : top.length === 0 ? (
        <div className="px-5 pb-5">
          <InlineEmpty>We couldn&apos;t capture results for this search. It will be tried again at the next check.</InlineEmpty>
        </div>
      ) : (
        <ol className="flex flex-col pb-2">
          {top.map((result) => (
            <li key={`${result.position}-${result.url}`} className="flex items-start gap-3 border-t border-border px-5 py-3 text-sm">
              <span className="g-num w-6 shrink-0 pt-0.5 text-right font-semibold text-muted-foreground">{result.position}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="truncate font-medium" title={result.title}>
                  {result.title || hostOf(result.url)}
                </p>
                <p className="truncate text-xs text-muted-foreground" title={result.url}>
                  {hostOf(result.url)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      </AutoHeight>
    </Section>
  );
}
