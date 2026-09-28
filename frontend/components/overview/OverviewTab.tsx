'use client';

import { useEffect, useState } from 'react';
import { getSnapshot, listSnapshots, type DataforseoSnapshot, type SerpRankRow } from '@/lib/dataforseo-api';
import { DomainStrip, type DomainOverview } from '@/components/overview/DomainStrip';
import { RankTable } from '@/components/overview/RankTable';
import { SerpSnapshotViewer, type SerpOption, type SerpResult } from '@/components/overview/SerpSnapshotViewer';
import { ExploreLinks } from '@/components/overview/ExploreLinks';
import { MetaDot, PageHeader, PortalPage, Tile } from '@/components/portal/layout';
import { EmptyState, PortalLoading } from '@/components/portal/states';
import { plural, relativeDate } from '@/components/portal/tone';

function num(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function str(raw: unknown): string {
  return typeof raw === 'string' ? raw : '';
}

function payloadOf(snapshot: DataforseoSnapshot | null | undefined): Record<string, unknown> {
  if (!snapshot || typeof snapshot.payload !== 'object' || snapshot.payload === null) return {};
  return snapshot.payload as unknown as Record<string, unknown>;
}

function newestFirst(snapshots: DataforseoSnapshot[]): DataforseoSnapshot[] {
  return [...snapshots].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Tolerates partial rows: keyword and position are required, the rest is defaulted. */
function rankingsOf(snapshot: DataforseoSnapshot | null | undefined): SerpRankRow[] {
  const payload = payloadOf(snapshot);
  if ('dataset' in payload && payload.dataset !== undefined && payload.dataset !== 'serp-ranks') return [];
  if (!Array.isArray(payload.rankings)) return [];
  const rows: SerpRankRow[] = [];
  for (const raw of payload.rankings) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.keyword !== 'string' || typeof row.position !== 'number') continue;
    if (!Number.isFinite(row.position)) continue;
    rows.push({
      keyword: row.keyword,
      url: str(row.url),
      position: row.position,
      prevPosition: num(row.prevPosition),
      volume: num(row.volume) ?? 0,
    });
  }
  return rows;
}

function keywordOf(snapshot: DataforseoSnapshot): string | null {
  const payload = payloadOf(snapshot);
  return typeof payload.keyword === 'string' && payload.keyword.length > 0 ? payload.keyword : null;
}

function resultsOf(snapshot: DataforseoSnapshot | null | undefined): SerpResult[] | null {
  const payload = payloadOf(snapshot);
  if ('dataset' in payload && payload.dataset !== undefined && payload.dataset !== 'serp-snapshot') return null;
  if (!Array.isArray(payload.results)) return null;
  const results: SerpResult[] = [];
  for (const raw of payload.results) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.position !== 'number' || !Number.isFinite(row.position)) continue;
    results.push({
      position: row.position,
      url: str(row.url),
      title: str(row.title),
      features: Array.isArray(row.features) ? row.features.filter((f): f is string => typeof f === 'string') : [],
    });
  }
  return results.sort((a, b) => a.position - b.position);
}

function domainOf(snapshot: DataforseoSnapshot | null | undefined): DomainOverview | null {
  const payload = payloadOf(snapshot);
  if (Object.keys(payload).length === 0) return null;
  if ('dataset' in payload && payload.dataset !== undefined && payload.dataset !== 'domain-overview') return null;
  if (
    num(payload.rank) === null &&
    num(payload.rankedKeywords) === null &&
    num(payload.trafficEstimate) === null &&
    num(payload.refDomains) === null
  ) {
    return null;
  }
  return {
    rank: num(payload.rank),
    rankedKeywords: num(payload.rankedKeywords),
    trafficEstimate: num(payload.trafficEstimate),
    refDomains: num(payload.refDomains),
  };
}

/**
 * Performance overview: domain strip, rank tracking, SERP snapshots, and
 * onward links. Every section degrades to an empty state when its dataset
 * hasn't landed yet, so a failed or missing check never breaks the page.
 */
export function OverviewTab({
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
  const [loading, setLoading] = useState(true);
  const [rankRows, setRankRows] = useState<SerpRankRow[]>([]);
  const [prevByKeyword, setPrevByKeyword] = useState<Map<string, number>>(new Map());
  const [ranksAt, setRanksAt] = useState<string | null>(null);
  const [serpOptions, setSerpOptions] = useState<SerpOption[]>([]);
  const [serpCache, setSerpCache] = useState<Record<string, SerpResult[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [domain, setDomain] = useState<DomainOverview | null>(null);
  const [domainAt, setDomainAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const ranks = listSnapshots(accessToken, clientId, projectId, 'serp-ranks')
      .then((snapshots) => {
        const ordered = newestFirst(snapshots);
        if (ordered.length === 0) return null;
        const previousId = ordered.length > 1 ? ordered[1].id : null;
        return Promise.all([
          getSnapshot(accessToken, clientId, ordered[0].id).catch(() => ordered[0]),
          previousId ? getSnapshot(accessToken, clientId, previousId).catch(() => null) : Promise.resolve(null),
        ]);
      })
      .then((pair) => {
        if (cancelled || !pair) return;
        const [latest, previous] = pair;
        const latestRows = rankingsOf(latest);
        const prevMap = new Map(rankingsOf(previous).map((row) => [row.keyword, row.position]));
        if (!cancelled) {
          setRankRows(latestRows);
          setPrevByKeyword(prevMap);
          setRanksAt(latest?.createdAt ?? null);
        }
      })
      .catch(() => {
        // Absent dataset — the table renders its empty state.
      });

    const serp = listSnapshots(accessToken, clientId, projectId, 'serp-snapshot')
      .then((snapshots) => {
        if (cancelled) return;
        const ordered = newestFirst(snapshots);
        const options = ordered.map((snapshot, i) => ({
          id: snapshot.id,
          keyword: keywordOf(snapshot) ?? `Snapshot ${snapshot.id.slice(0, 8) || i + 1}`,
        }));
        const seeded: Record<string, SerpResult[]> = {};
        for (const snapshot of ordered) {
          const results = resultsOf(snapshot);
          if (results) seeded[snapshot.id] = results;
        }
        if (!cancelled) {
          setSerpOptions(options);
          setSerpCache(seeded);
          setSelectedId(options.length > 0 ? options[0].id : null);
        }
      })
      .catch(() => {
        // Absent dataset — the viewer renders its empty state.
      });

    const domainOverview = listSnapshots(accessToken, clientId, projectId, 'domain-overview')
      .then((snapshots) => {
        const ordered = newestFirst(snapshots);
        if (ordered.length === 0) return null;
        const parsed = domainOf(ordered[0]);
        if (parsed) return { domain: parsed, at: ordered[0].createdAt };
        return getSnapshot(accessToken, clientId, ordered[0].id)
          .then((full) => {
            const retry = domainOf(full);
            return retry ? { domain: retry, at: full.createdAt } : null;
          })
          .catch(() => null);
      })
      .then((result) => {
        if (cancelled || !result) return;
        if (!cancelled) {
          setDomain(result.domain);
          setDomainAt(result.at);
        }
      })
      .catch(() => {
        // Absent dataset — the strip renders its empty state.
      });

    Promise.all([ranks, serp, domainOverview]).then(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, projectId]);

  // Lazy-loads the selected SERP snapshot's detail when the list payload
  // didn't already carry its results.
  useEffect(() => {
    if (!selectedId || serpCache[selectedId]) return;
    let cancelled = false;

    getSnapshot(accessToken, clientId, selectedId)
      .then((snapshot) => {
        if (!cancelled) {
          setSerpCache((prev) => ({ ...prev, [selectedId]: resultsOf(snapshot) ?? [] }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSerpCache((prev) => ({ ...prev, [selectedId]: [] }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, selectedId, serpCache]);

  if (loading) {
    return <PortalLoading label="Loading performance" />;
  }

  // ─── Headline: the answer before the numbers ───────────────────────
  let climbers = 0;
  let fallers = 0;
  for (const row of rankRows) {
    const prev = prevByKeyword.get(row.keyword) ?? row.prevPosition ?? null;
    if (prev !== null) {
      if (row.position < prev) climbers += 1;
      else if (row.position > prev) fallers += 1;
    }
  }
  const pageOne = rankRows.filter((r) => r.position <= 10).length;
  const nothingYet = !domain && rankRows.length === 0 && serpOptions.length === 0;
  const checkedAt = [ranksAt, domainAt].filter((d): d is string => !!d).sort().at(-1) ?? null;

  let summary: string | null = null;
  if (rankRows.length > 0) {
    summary = `You're on Google's first page for ${pageOne} of ${plural(rankRows.length, 'tracked search', 'tracked searches')}.`;
    if (climbers > 0 || fallers > 0) summary += ` Since the last check, ${climbers} moved up and ${fallers} moved down.`;
  }

  return (
    <PortalPage>
      <PageHeader
        eyebrow="Performance"
        title="Search overview"
        meta={
          <>
            <span>{projectName}</span>
            {checkedAt ? (
              <>
                <MetaDot />
                <span>Checked {relativeDate(checkedAt)}</span>
              </>
            ) : null}
          </>
        }
        summary={summary ?? undefined}
      />

      {nothingYet ? (
        <Tile index={1}>
          <EmptyState
            title="Your search overview is on its way"
            body="This page will show how strong your site is in Google, where you appear for the searches that matter and who shows up above you."
          />
        </Tile>
      ) : (
        <>
          <DomainStrip domain={domain} />
          <RankTable index={5} rows={rankRows} prevByKeyword={prevByKeyword} pulledAt={ranksAt} />
          <SerpSnapshotViewer
            index={6}
            options={serpOptions}
            selectedId={selectedId}
            onSelect={setSelectedId}
            results={selectedId ? (serpCache[selectedId] ?? null) : null}
          />
        </>
      )}

      <div className="flex flex-col gap-3">
        <p className="g-eyebrow">Look closer</p>
        <ExploreLinks projectId={projectId} index={7} />
      </div>
    </PortalPage>
  );
}
