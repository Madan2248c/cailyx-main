'use client';

import { useEffect, useState } from 'react';
import { Target } from 'lucide-react';
import {
  coerceKeywordRow,
  getLatestSnapshot,
  keywordIdeasOf,
  keywordOverviewOf,
  type KeywordOverviewRow,
} from '@/lib/dataforseo-api';
import { EmptyPage, MoreNote, NextSteps, Section, Stat, StatRow, type NextStep } from '@/components/portal/blocks';
import { Meter } from '@/components/portal/charts';
import { MetaDot, PageHeader, PortalPage, StatusChip } from '@/components/portal/layout';
import { ErrorState, PortalLoading } from '@/components/portal/states';
import { plural, type Tone } from '@/components/portal/tone';

const WINNABLE_DIFFICULTY = 30;
const WINNABLE_VOLUME = 100;
const TABLE_LIMIT = 30;
const WINNABLE_LIMIT = 5;

/** Difficulty in words: how hard it is to reach page one for this search. */
function difficulty(value: number): { word: string; tone: Tone } {
  if (!Number.isFinite(value)) return { word: 'Unknown', tone: 'neutral' };
  if (value <= WINNABLE_DIFFICULTY) return { word: 'Easy', tone: 'good' };
  if (value <= 60) return { word: 'Medium', tone: 'watch' };
  return { word: 'Hard', tone: 'bad' };
}

function formatCpc(cpc: number): string {
  return Number.isFinite(cpc) && cpc > 0 ? `$${cpc.toFixed(2)}` : '–';
}

function isWinnable(row: KeywordOverviewRow): boolean {
  return row.difficulty <= WINNABLE_DIFFICULTY && row.volume >= WINNABLE_VOLUME;
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

  if (state === 'loading') return <PortalLoading label="Loading keywords" />;
  if (state === 'error') return <ErrorState title="We couldn't load your keywords" message={error ?? 'Unknown error'} />;
  if (!keywords) return null;

  // Keyword datasets land alongside the other checks, so an empty list is
  // expected before the first one finishes.
  if (keywords.length === 0) {
    return (
      <EmptyPage
        eyebrow="Search"
        title="Keywords"
        projectName={projectName}
        emptyTitle="Your keyword list is on its way"
        body="This page will show the searches your buyers type into Google, how many people make each search every month and how hard each one is to win."
        steps={[
          'We look up the searches related to your business and your rivals.',
          'Each search gets a monthly volume and a difficulty score.',
          'The easiest searches worth winning are picked out for you at the top.',
        ]}
      />
    );
  }

  const winnableAll = keywords.filter(isWinnable);
  const winnable = winnableAll.slice(0, WINNABLE_LIMIT);
  const totalVolume = keywords.reduce((sum, row) => sum + (Number.isFinite(row.volume) ? row.volume : 0), 0);
  const visible = keywords.slice(0, TABLE_LIMIT);

  const steps: NextStep[] = [];
  if (winnable[0]) {
    steps.push({
      tone: 'good',
      lead: `Start with “${winnable[0].keyword}”.`,
      text: `About ${winnable[0].volume.toLocaleString()} searches a month and easy to win. A focused page that answers this search is the quickest gain here.`,
    });
  }
  const bigHard = keywords.find((row) => difficulty(row.difficulty).tone === 'bad' && row.volume >= 1000);
  if (bigHard) {
    steps.push({
      tone: 'watch',
      lead: `“${bigHard.keyword}” is popular but hard.`,
      text: `${bigHard.volume.toLocaleString()} searches a month. Treat it as a longer-term goal and win the easier related searches first.`,
    });
  }

  return (
    <PortalPage>
      <PageHeader
        eyebrow="Search"
        title="Keywords"
        meta={
          <>
            <span>{projectName}</span>
            <MetaDot />
            <span>{plural(keywords.length, 'search', 'searches')} tracked</span>
          </>
        }
        summary={
          winnableAll.length > 0
            ? `${plural(winnableAll.length, 'search is', 'searches are')} easy enough to win now and worth the effort. They are listed first.`
            : 'None of your searches are easy wins yet. The table shows which ones are closest.'
        }
      />

      <StatRow>
        <Stat index={1} label="Searches tracked" value={keywords.length} caption="Searches related to your business" />
        <Stat index={2} label="Monthly searches" value={totalVolume} caption="How often people make these searches each month, in total" />
        <Stat
          index={3}
          label="Easy wins"
          value={winnableAll.length}
          tone={winnableAll.length > 0 ? 'good' : 'neutral'}
          caption={`Easy to rank for, with at least ${WINNABLE_VOLUME} searches a month`}
          hint="Difficulty runs from 0 to 100. We count a search as an easy win when its difficulty is 30 or less and at least 100 people make it each month."
        />
      </StatRow>

      <NextSteps index={4} items={steps} allClear="Nothing stands out yet. Check back after the next update." />

      {winnable.length > 0 ? (
        <Section index={5} icon={Target} eyebrow="Easy wins" description="Low difficulty and real demand. Go after these first.">
          <ul className="flex flex-col gap-2">
            {winnable.map((row) => (
              <li key={row.keyword} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
                <p className="min-w-0 flex-1 font-medium">{row.keyword}</p>
                <p className="g-num shrink-0 text-muted-foreground">
                  <span className="font-medium text-foreground">{row.volume.toLocaleString()}</span> a month
                </p>
                <StatusChip tone="good">Easy · {row.difficulty}</StatusChip>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section index={6} eyebrow="All searches" description="Most searched first." flush>
        <div className="overflow-x-auto">
          <table className="g-table min-w-[560px]">
            <thead>
              <tr>
                <th>Search</th>
                <th className="g-num-cell">Searches a month</th>
                <th>Difficulty</th>
                <th className="g-num-cell" title="What advertisers pay Google for one click on this search">
                  Ad cost per click
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const d = difficulty(row.difficulty);
                return (
                  <tr key={row.keyword}>
                    <td>
                      <span className="font-medium">{row.keyword}</span>
                      {isWinnable(row) ? <span className="ml-2 text-xs font-medium text-success">Easy win</span> : null}
                    </td>
                    <td className="g-num-cell">{row.volume.toLocaleString()}</td>
                    <td>
                      <div className="flex min-w-40 items-center gap-2.5">
                        <span className="w-20 shrink-0 text-xs text-muted-foreground">
                          {d.word}{' '}
                          <span className="g-num font-semibold text-foreground">{Number.isFinite(row.difficulty) ? row.difficulty : ''}</span>
                        </span>
                        <div className="flex-1">
                          <Meter value={Number.isFinite(row.difficulty) ? row.difficulty : 0} tone={d.tone} height={5} label={`Difficulty ${row.difficulty} of 100`} />
                        </div>
                      </div>
                    </td>
                    <td className="g-num-cell text-muted-foreground">{formatCpc(row.cpc)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <MoreNote shown={visible.length} total={keywords.length} noun="searches" />
      </Section>
    </PortalPage>
  );
}
