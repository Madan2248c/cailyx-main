'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  backlinkRowsOf,
  backlinksSummaryOf,
  getLatestSnapshot,
  referringDomainsOf,
  topPagesOf,
  type BacklinkRow,
  type ReferringDomainRow,
  type TopPageRow,
} from '@/lib/dataforseo-api';
import { PortalLoading } from '@/components/portal/states';
import { StaggerIn } from '@/components/portal/reveal';
import { Num } from '@/components/portal/motion';

const TOXIC_SPAM_SCORE = 60;
const ROW_LIMIT = 20;
const DOMAIN_LIMIT = 15;
const PAGE_LIMIT = 10;

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.hostname}${path}`;
  } catch {
    return url;
  }
}

function spamTone(score: number): string {
  if (!Number.isFinite(score)) return 'text-muted-foreground';
  if (score >= TOXIC_SPAM_SCORE) return 'text-danger';
  if (score >= 30) return 'text-warning';
  return 'text-success';
}

interface Loaded {
  summary: { referringDomains: number; newBacklinks: number; lostBacklinks: number } | null;
  rows: BacklinkRow[];
  domains: ReferringDomainRow[];
  pages: TopPageRow[];
}

export function BacklinksSection({
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
  const [data, setData] = useState<Loaded | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      getLatestSnapshot(accessToken, clientId, projectId, 'backlinks-summary'),
      getLatestSnapshot(accessToken, clientId, projectId, 'backlink-rows'),
      getLatestSnapshot(accessToken, clientId, projectId, 'referring-domains'),
      getLatestSnapshot(accessToken, clientId, projectId, 'top-pages'),
    ])
      .then(([summarySnap, rowsSnap, domainsSnap, pagesSnap]) => {
        if (cancelled) return;
        setData({
          summary: backlinksSummaryOf(summarySnap),
          rows: backlinkRowsOf(rowsSnap),
          domains: referringDomainsOf(domainsSnap),
          pages: topPagesOf(pagesSnap),
        });
        setState('ready');
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load backlinks');
          setState('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, projectId]);

  if (state === 'loading') {
    return <PortalLoading label="Loading backlinks" />;
  }

  if (state === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const hasAnything =
    data.summary !== null || data.rows.length > 0 || data.domains.length > 0 || data.pages.length > 0;

  // Empty state: the backend lands snapshot datasets in parallel, so any or
  // all of them may legitimately be absent.
  if (!hasAnything) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
        <div>
          <h1 className="text-2xl font-semibold">Backlinks</h1>
          <p className="text-sm text-muted-foreground">{projectName}</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              No backlink data yet. Snapshots appear here automatically once the first backlink pull
              runs for this project — check back soon.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const lostRows = data.rows.filter((row) => row.lost);
  const liveRows = data.rows.filter((row) => !row.lost);
  const toxicRows = [...liveRows]
    .filter((row) => Number.isFinite(row.spamScore) && row.spamScore >= TOXIC_SPAM_SCORE)
    .sort((a, b) => b.spamScore - a.spamScore);
  const newRows = [...liveRows].sort((a, b) =>
    (b.firstSeen ?? '').localeCompare(a.firstSeen ?? ''),
  );

  const referringDomains = data.summary?.referringDomains ?? data.domains.length;
  const newBacklinks = data.summary?.newBacklinks ?? newRows.length;
  const lostBacklinks = data.summary?.lostBacklinks ?? lostRows.length;
  const broken = lostRows.length;

  const actions: string[] = [];
  if (newBacklinks > 0) {
    const newest = newRows[0];
    actions.push(
      newest
        ? `${newBacklinks} new ${newBacklinks === 1 ? 'backlink' : 'backlinks'} — latest from ${shortUrl(newest.sourceUrl)}. Keep earning links from sites like it.`
        : `${newBacklinks} new ${newBacklinks === 1 ? 'backlink' : 'backlinks'} since the last pull.`,
    );
  }
  if (lostBacklinks > 0) {
    actions.push(
      `${lostBacklinks} lost ${lostBacklinks === 1 ? 'backlink' : 'backlinks'} — review the flagged rows below and reclaim the ones on pages you control or can reach out to.`,
    );
  }
  if (toxicRows.length > 0) {
    actions.push(
      `${toxicRows.length} live ${toxicRows.length === 1 ? 'link looks' : 'links look'} toxic (spam score ≥ ${TOXIC_SPAM_SCORE}) — disavow ${toxicRows.length === 1 ? 'it' : 'them'} so they stop dragging down trust.`,
    );
  }
  if (actions.length === 0) {
    actions.push('No new, lost, or toxic links in the latest pull — your link profile is steady.');
  }

  const visibleRows = [...data.rows].sort((a, b) => Number(a.lost) - Number(b.lost)).slice(0, ROW_LIMIT);
  const visibleDomains = [...data.domains]
    .sort((a, b) => b.backlinks - a.backlinks)
    .slice(0, DOMAIN_LIMIT);
  const visiblePages = [...data.pages]
    .sort((a, b) => b.backlinks - a.backlinks)
    .slice(0, PAGE_LIMIT);

  return (
    <StaggerIn>
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Backlinks</h1>
        <p className="text-sm text-muted-foreground">
          {projectName}
          {referringDomains > 0 ? ` · ${referringDomains} referring domains` : ''}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Referring domains</p>
            <p className="text-4xl font-semibold"><Num value={referringDomains} /></p>
            <p className="text-xs text-muted-foreground">unique sites linking to you</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <p className="text-xs font-medium text-muted-foreground">New backlinks</p>
            <p className="text-4xl font-semibold text-success"><Num value={newBacklinks} /></p>
            <p className="text-xs text-muted-foreground">gained since the last pull</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Lost backlinks</p>
            <p className="text-4xl font-semibold text-danger"><Num value={lostBacklinks} /></p>
            <p className="text-xs text-muted-foreground">gone since the last pull</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Broken</p>
            <p className="text-4xl font-semibold text-warning"><Num value={broken} /></p>
            <p className="text-xs text-muted-foreground">flagged links to reclaim</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What to do next</CardTitle>
          <CardDescription>New, lost, and toxic links first</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {actions.map((action) => (
            <p key={action.slice(0, 48)} className="text-sm">
              {action}
            </p>
          ))}
        </CardContent>
      </Card>

      {data.rows.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Backlinks</CardTitle>
            <CardDescription>Source → target, newest and lost first</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col overflow-x-auto p-0">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-6 py-2.5 font-medium">Source → target</th>
                  <th className="px-4 py-2.5 font-medium">Anchor</th>
                  <th className="px-4 py-2.5 font-medium">Link</th>
                  <th className="px-4 py-2.5 font-medium">Spam</th>
                  <th className="px-6 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={`${row.sourceUrl}${row.targetUrl}`} className="border-t border-border align-top">
                    <td className="px-6 py-3">
                      <p className="break-all font-medium">{shortUrl(row.sourceUrl)}</p>
                      <p className="break-all text-xs text-muted-foreground">→ {shortUrl(row.targetUrl)}</p>
                    </td>
                    <td className="max-w-40 truncate px-4 py-3">
                      {row.anchor === '' ? <span className="text-muted-foreground">—</span> : row.anchor}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={row.isDofollow ? 'secondary' : 'outline'} className="shrink-0">
                        {row.isDofollow ? 'Dofollow' : 'Nofollow'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-medium ${spamTone(row.spamScore)}`}>
                        {Number.isFinite(row.spamScore) ? row.spamScore : '—'}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      {row.lost ? (
                        <Badge variant="destructive" className="shrink-0">
                          LOST
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          seen {formatDate(row.lastSeen)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.rows.length > visibleRows.length ? (
              <p className="px-6 py-3 text-xs text-muted-foreground">
                + {data.rows.length - visibleRows.length} more backlinks in this pull.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              No individual backlink rows in the latest pull yet.
            </p>
          </CardContent>
        </Card>
      )}

      {data.domains.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Referring domains</CardTitle>
            <CardDescription>Who links to you the most</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col overflow-x-auto p-0">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-6 py-2.5 font-medium">Domain</th>
                  <th className="px-4 py-2.5 font-medium">Backlinks</th>
                  <th className="px-6 py-2.5 font-medium">First seen</th>
                </tr>
              </thead>
              <tbody>
                {visibleDomains.map((domain) => (
                  <tr key={domain.domain} className="border-t border-border">
                    <td className="break-all px-6 py-3 font-medium">{domain.domain}</td>
                    <td className="px-4 py-3">{domain.backlinks}</td>
                    <td className="px-6 py-3 text-muted-foreground">{formatDate(domain.firstSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.domains.length > visibleDomains.length ? (
              <p className="px-6 py-3 text-xs text-muted-foreground">
                + {data.domains.length - visibleDomains.length} more domains in this pull.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              No referring-domain breakdown in the latest pull yet.
            </p>
          </CardContent>
        </Card>
      )}

      {data.pages.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top linked pages</CardTitle>
            <CardDescription>Your pages attracting the most links</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <ul className="flex flex-col gap-2">
              {visiblePages.map((page) => (
                <li
                  key={page.url}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <p className="min-w-0 flex-1 truncate font-medium">{shortUrl(page.url)}</p>
                  <p className="shrink-0 text-muted-foreground">
                    {page.backlinks} {page.backlinks === 1 ? 'link' : 'links'} · {page.refDomains}{' '}
                    {page.refDomains === 1 ? 'domain' : 'domains'}
                  </p>
                </li>
              ))}
            </ul>
            {data.pages.length > visiblePages.length ? (
              <p className="text-xs text-muted-foreground">
                + {data.pages.length - visiblePages.length} more pages in this pull.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              No top-pages breakdown in the latest pull yet.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
    </StaggerIn>
  );
}
