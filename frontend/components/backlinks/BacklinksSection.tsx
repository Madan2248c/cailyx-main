'use client';

import { useEffect, useState } from 'react';
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
import { EmptyPage, MoreNote, NextSteps, Section, Stat, StatRow, type NextStep } from '@/components/portal/blocks';
import { Meter } from '@/components/portal/charts';
import { MetaDot, PageHeader, PortalPage, StatusChip } from '@/components/portal/layout';
import { ErrorState, PortalLoading } from '@/components/portal/states';
import { plural, TONE_TEXT, type Tone } from '@/components/portal/tone';

const TOXIC_SPAM_SCORE = 60;
const ROW_LIMIT = 20;
const DOMAIN_LIMIT = 15;
const PAGE_LIMIT = 10;

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '–';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '–'
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Just the path of one of your own pages ("/pricing"), or "Homepage". */
function shortPath(url: string): string {
  try {
    const path = new URL(url).pathname;
    return path === '/' || path === '' ? 'Homepage' : path;
  } catch {
    return url;
  }
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

function spamTone(score: number): Tone {
  if (!Number.isFinite(score)) return 'neutral';
  if (score >= TOXIC_SPAM_SCORE) return 'bad';
  if (score >= 30) return 'watch';
  return 'good';
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

  if (state === 'loading') return <PortalLoading label="Loading backlinks" />;
  if (state === 'error') return <ErrorState title="We couldn't load your backlinks" message={error ?? 'Unknown error'} />;
  if (!data) return null;

  const hasAnything =
    data.summary !== null || data.rows.length > 0 || data.domains.length > 0 || data.pages.length > 0;

  // The datasets land independently, so any or all may be absent early on.
  if (!hasAnything) {
    return (
      <EmptyPage
        eyebrow="Search"
        title="Backlinks"
        projectName={projectName}
        emptyTitle="Your backlink check is on its way"
        body="Backlinks are links to your site from other websites. Search engines and AI tools treat them as votes of trust, so this page shows who links to you and what changed."
        steps={[
          'We find the websites that link to yours.',
          'Each link is checked for quality, so spammy ones are flagged.',
          'After that, you see new and lost links every time we check again.',
        ]}
      />
    );
  }

  const lostRows = data.rows.filter((row) => row.lost);
  const liveRows = data.rows.filter((row) => !row.lost);
  const toxicRows = [...liveRows]
    .filter((row) => Number.isFinite(row.spamScore) && row.spamScore >= TOXIC_SPAM_SCORE)
    .sort((a, b) => b.spamScore - a.spamScore);
  const newRows = [...liveRows].sort((a, b) => (b.firstSeen ?? '').localeCompare(a.firstSeen ?? ''));

  const referringDomains = data.summary?.referringDomains ?? data.domains.length;
  const newBacklinks = data.summary?.newBacklinks ?? newRows.length;
  const lostBacklinks = data.summary?.lostBacklinks ?? lostRows.length;

  const steps: NextStep[] = [];
  if (lostBacklinks > 0) {
    steps.push({
      tone: 'bad',
      lead: `${plural(lostBacklinks, 'link')} lost.`,
      text: 'Check the ones marked Lost below. If a site you know removed its link, a short note asking them to restore it often works.',
    });
  }
  if (toxicRows.length > 0) {
    steps.push({
      tone: 'watch',
      lead: `${plural(toxicRows.length, 'link looks', 'links look')} spammy.`,
      text: 'Links from low-quality sites can hurt trust. Your Rothenhall lead can ask Google to ignore them.',
    });
  }
  if (newBacklinks > 0) {
    const newest = newRows[0];
    steps.push({
      tone: 'good',
      lead: `${plural(newBacklinks, 'new link')} since the last check.`,
      text: newest ? `The latest is from ${shortUrl(newest.sourceUrl)}. Sites like it are worth approaching again.` : undefined,
    });
  }

  const visibleRows = [...data.rows].sort((a, b) => Number(b.lost) - Number(a.lost)).slice(0, ROW_LIMIT);
  const visibleDomains = [...data.domains].sort((a, b) => b.backlinks - a.backlinks).slice(0, DOMAIN_LIMIT);
  const visiblePages = [...data.pages].sort((a, b) => b.backlinks - a.backlinks).slice(0, PAGE_LIMIT);
  const topPageMax = Math.max(1, ...visiblePages.map((p) => p.backlinks));

  return (
    <PortalPage>
      <PageHeader
        eyebrow="Search"
        title="Backlinks"
        meta={
          <>
            <span>{projectName}</span>
            {referringDomains > 0 ? (
              <>
                <MetaDot />
                <span>{plural(referringDomains, 'website')} link to you</span>
              </>
            ) : null}
          </>
        }
        summary="Links from other websites tell search engines and AI tools that you can be trusted. More links from good sites means more trust."
      />

      <StatRow cols={4}>
        <Stat
          index={1}
          label="Linking websites"
          value={referringDomains}
          caption="Different websites that link to you"
          hint="Counted once per website, however many links it has. Ten sites with one link each count for more than one site with ten."
        />
        <Stat index={2} label="New links" value={newBacklinks} tone={newBacklinks > 0 ? 'good' : 'neutral'} caption="Gained since the last check" />
        <Stat index={3} label="Lost links" value={lostBacklinks} tone={lostBacklinks > 0 ? 'bad' : 'neutral'} caption="Gone since the last check" />
        <Stat
          index={4}
          label="Spammy links"
          value={toxicRows.length}
          tone={toxicRows.length > 0 ? 'watch' : 'neutral'}
          caption="From low-quality sites"
          hint={`Each link gets a spam score from 0 to 100. We flag links scoring ${TOXIC_SPAM_SCORE} or more.`}
        />
      </StatRow>

      <NextSteps index={5} items={steps} allClear="Nothing to act on. Your links are steady since the last check." />

      <div className="grid gap-4 lg:grid-cols-2">
        {visibleDomains.length > 0 ? (
          <Section index={6} eyebrow="Who links to you most" flush>
            <table className="g-table">
              <thead>
                <tr>
                  <th>Website</th>
                  <th className="g-num-cell">Links</th>
                  <th className="g-num-cell">Since</th>
                </tr>
              </thead>
              <tbody>
                {visibleDomains.map((domain) => (
                  <tr key={domain.domain}>
                    <td className="break-all font-medium">{domain.domain}</td>
                    <td className="g-num-cell">{domain.backlinks.toLocaleString()}</td>
                    <td className="g-num-cell text-muted-foreground">{formatDate(domain.firstSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <MoreNote shown={visibleDomains.length} total={data.domains.length} noun="websites" />
          </Section>
        ) : null}

        {visiblePages.length > 0 ? (
          <Section index={7} eyebrow="Your most linked pages">
            <ul className="flex flex-col gap-3">
              {visiblePages.map((page, i) => (
                <li key={page.url} className="flex flex-col gap-1.5 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate font-medium" title={page.url}>
                      {shortPath(page.url)}
                    </p>
                    <p className="g-num shrink-0 text-muted-foreground">
                      <span className="font-medium text-foreground">{page.backlinks.toLocaleString()}</span> links ·{' '}
                      {plural(page.refDomains, 'site')}
                    </p>
                  </div>
                  <Meter value={page.backlinks} max={topPageMax} height={4} index={i} label={`${page.backlinks} links`} />
                </li>
              ))}
            </ul>
            {data.pages.length > visiblePages.length ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Showing the top {visiblePages.length} of {data.pages.length} pages.
              </p>
            ) : null}
          </Section>
        ) : null}
      </div>

      {visibleRows.length > 0 ? (
        <Section index={8} eyebrow="Individual links" description="Lost links first, then the rest." flush>
          <div className="overflow-x-auto">
            <table className="g-table min-w-[720px]">
              <thead>
                <tr>
                  <th>Linking page</th>
                  <th>Link text</th>
                  <th title="Followed links pass trust to your site. Unfollowed links still bring visitors but pass less trust.">Passes trust</th>
                  <th className="g-num-cell">Spam score</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={`${row.sourceUrl}${row.targetUrl}`}>
                    <td>
                      <p className="break-all font-medium">{shortUrl(row.sourceUrl)}</p>
                      <p className="break-all text-xs text-muted-foreground">to {shortPath(row.targetUrl)}</p>
                    </td>
                    <td className="max-w-44 truncate">
                      {row.anchor === '' ? <span className="text-muted-foreground">No text</span> : row.anchor}
                    </td>
                    <td className={row.isDofollow ? '' : 'text-muted-foreground'}>{row.isDofollow ? 'Yes' : 'No'}</td>
                    <td className={`g-num-cell font-medium ${TONE_TEXT[spamTone(row.spamScore)]}`}>
                      {Number.isFinite(row.spamScore) ? row.spamScore : '–'}
                    </td>
                    <td>
                      {row.lost ? (
                        <StatusChip tone="bad">Lost</StatusChip>
                      ) : (
                        <span className="text-xs text-muted-foreground">Seen {formatDate(row.lastSeen)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <MoreNote shown={visibleRows.length} total={data.rows.length} noun="links" />
        </Section>
      ) : null}
    </PortalPage>
  );
}
