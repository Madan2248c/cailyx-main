'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CircleCheck, Code, FileSearch, ListChecks, Minus, TriangleAlert, Zap } from 'lucide-react';
import { Gauge } from '@/components/animate-ui/icons/gauge';
import { Bot } from '@/components/animate-ui/icons/bot';
import { Clock } from '@/components/animate-ui/icons/clock';
import { ShimmeringText } from '@/components/animate-ui/primitives/texts/shimmering';
import { Meter, ScoreRing, Sparkline } from '@/components/portal/charts';
import { DeltaChip, MetaDot, PageHeader, PortalPage, StatusChip, Tile, TileHeader } from '@/components/portal/layout';
import { Marker } from '@/components/portal/marker';
import { CountUp } from '@/components/portal/motion';
import { EmptyState, ErrorState, PortalLoading } from '@/components/portal/states';
import { formatDate, plural, scoreTone, TONE_TEXT, TONE_WORD, type Tone } from '@/components/portal/tone';
import { getTechnicalAuditTrend, listTechnicalAuditRuns } from '@/lib/technical-api';
import type { AuditCheckType, AuditStatus, TechnicalAuditRun, TrendPoint } from '@/types/technical';
import { CHECK_LABEL, CHECK_ORDER, ISSUE_LABEL, type PageIssueCode } from '@/types/technical';

function num(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function str(raw: unknown): string | null {
  return typeof raw === 'string' ? raw : null;
}

function cwvTone(status: string | null): Tone {
  if (status === 'good') return 'good';
  if (status === 'needs-improvement') return 'watch';
  if (status === 'poor') return 'bad';
  return 'neutral';
}

const CWV_WORD: Record<string, string> = { good: 'Good', 'needs-improvement': 'Needs work', poor: 'Poor' };

function formatMetric(value: number | null, unit: 'ms' | '' | 's'): string {
  if (value === null) return '—';
  if (unit === 's') return `${value.toFixed(2)} s`;
  if (unit === 'ms') return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
  return String(Math.round(value * 100) / 100);
}

function checkTone(status: AuditStatus | undefined): Tone {
  if (status === 'pass') return 'good';
  if (status === 'fail') return 'bad';
  if (status === 'error') return 'watch';
  return 'neutral';
}

const CHECK_WORD: Record<AuditStatus, string> = { pass: 'Pass', fail: 'Fix', error: 'Error', 'not-run': 'Not run' };

/** Which Fix Plan group a failing check's fixes live in (page issues span several, so no focus). */
const FIX_GROUP: Partial<Record<AuditCheckType, string>> = {
  robots: 'robots',
  'cdn-inferred': 'cdn',
  sitemap: 'sitemap',
  'js-render': 'rendering',
  cwv: 'performance',
  schema: 'schema',
  'agent-readiness': 'agent-readiness',
};

export function TechnicalTab({
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
  const [runs, setRuns] = useState<TechnicalAuditRun[] | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    listTechnicalAuditRuns(accessToken, clientId, projectId)
      .then((runList) => {
        if (!cancelled) setRuns(runList);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load the audit');
      });
    getTechnicalAuditTrend(accessToken, clientId, projectId)
      .then((points) => {
        if (!cancelled) setTrend(points);
      })
      .catch(() => {
        // The trend line is a bonus; the page works without it.
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, projectId]);

  if (error) return <ErrorState message={error} />;
  if (!runs) return <PortalLoading label="Loading technical audit" />;

  const latest = runs.find((r) => r.status === 'COMPLETE') ?? null;
  const pending = runs.find((r) => r.status === 'QUEUED' || r.status === 'RUNNING') ?? null;

  if (!latest) {
    return (
      <PortalPage>
        <PageHeader eyebrow="Performance" title="Technical health" meta={<span>{projectName}</span>} />
        <Tile index={1}>
          {pending ? (
            <div className="flex justify-center pt-8">
              <ShimmeringText text="Auditing your site…" className="text-sm font-medium" color="var(--g-ink-muted)" shimmeringColor="var(--g-ink)" />
            </div>
          ) : null}
          <EmptyState
            title={pending ? 'Audit in progress' : 'Not measured yet'}
            body={
              pending
                ? 'An audit is running right now. Results appear here when it finishes.'
                : 'Your first site check is running. Results appear here as soon as it finishes.'
            }
          />
        </Tile>
      </PortalPage>
    );
  }

  const findingsByType = new Map(latest.findings.map((f) => [f.type, f]));
  const cwv = findingsByType.get('cwv')?.detail ?? {};
  const inventory = findingsByType.get('page-inventory')?.detail ?? {};
  const agent = findingsByType.get('agent-readiness')?.detail ?? {};
  const movers = latest.deltas.filter((d) => d.change !== null && d.change !== 0 && d.direction !== 'unchanged');

  const crawled = num(inventory.crawled);
  const withoutJsonLd = num(inventory.pagesWithoutJsonLd);
  const withJsonLd = crawled !== null && withoutJsonLd !== null ? crawled - withoutJsonLd : null;
  const jsonLdPct = crawled && withJsonLd !== null ? Math.round((withJsonLd / crawled) * 100) : null;
  const agentScore = num(agent.score);
  const tone = scoreTone(latest.score);
  const jsRender = findingsByType.get('js-render')?.detail ?? {};
  const jsDependent = jsRender.isJsDependent === true;
  const contentLoss = num(jsRender.contentLossPercent);

  const checks = CHECK_ORDER.map((type) => ({ type, finding: findingsByType.get(type) }));
  const passing = checks.filter((c) => c.finding?.status === 'pass').length;
  const failing = checks.filter((c) => c.finding?.status === 'fail' || c.finding?.status === 'error');
  const scored = trend.filter((p) => p.score !== null).map((p) => p.score as number);
  const scoreChange = scored.length >= 2 ? scored[scored.length - 1] - scored[scored.length - 2] : null;

  const structureRows: Array<[string, number | null, string | null]> = [
    ['Pages with weak titles', num(inventory.pagesWithBadTitle), null],
    ['Pages with weak meta descriptions', num(inventory.pagesWithBadMeta), null],
    ['Thin content pages', num(inventory.pagesThin), null],
    ['Pages with heading issues', num(inventory.pagesWithHeadingIssues), null],
    ['Images missing alt text', num(inventory.imagesMissingAlt), num(inventory.imagesTotal) !== null ? `of ${inventory.imagesTotal}` : null],
    ['Pages with duplicate content', num(inventory.pagesWithDuplicateContent), null],
    ['Pages with canonical issues', num(inventory.pagesWithBadCanonical), null],
  ];

  const issueCounts = (inventory.issueCounts ?? {}) as Record<string, number>;
  const issues = (Object.entries(issueCounts) as Array<[PageIssueCode, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  const maxIssue = Math.max(1, ...issues.map(([, c]) => c));

  const categories = (cwv.categories ?? {}) as Record<string, number>;
  const categoryRows = ['performance', 'seo', 'accessibility', 'best-practices'].map((key) => ({
    key,
    label: key === 'seo' ? 'SEO' : key.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    value: num(categories[key]),
  }));
  const failedAudits = (Array.isArray(cwv.failedAudits) ? cwv.failedAudits : []) as Array<{ title: string; displayValue: string }>;
  const agentIssues = (Array.isArray(agent.issues) ? agent.issues : []) as Array<{ name: string; recommendation: string }>;
  const breakdown = (agent.breakdown && typeof agent.breakdown === 'object'
    ? agent.breakdown
    : {}) as { essential?: { passing?: number; total?: number }; recommended?: { passing?: number; total?: number } };

  const summary = (
    <>
      {latest.score !== null ? (
        <>
          Your site scores <Marker text={`${latest.score} out of 100`} />.{' '}
        </>
      ) : null}
      {passing} of {checks.length} checks pass
      {failing.length > 0 ? `, and ${plural(failing.length, 'needs', 'need')} a fix.` : '.'}
    </>
  );

  return (
    <PortalPage>
      <PageHeader
        eyebrow="Performance"
        title="Technical health"
        meta={
          <>
            <span>{projectName}</span>
            <MetaDot />
            <span>Audited {formatDate(latest.completedAt ?? latest.createdAt)}</span>
            {crawled !== null ? (
              <>
                <MetaDot />
                <span>{plural(crawled, 'page')} checked</span>
              </>
            ) : null}
          </>
        }
        summary={summary}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {/* Hero: score + the eight checks at a glance */}
        <Tile index={0} className="md:col-span-2 md:row-span-2 gap-5 p-6">
          <TileHeader icon={Gauge} eyebrow="Site score" hint="A weighted score across the 8 checks below. 80+ is healthy, 50 to 79 needs work, under 50 is at risk." right={<StatusChip tone={tone}>{TONE_WORD[tone]}</StatusChip>} />
          <div className="flex flex-wrap items-center gap-6">
            <ScoreRing value={latest.score} tone={tone} size={148} stroke={12} label={`Site score ${latest.score ?? 'not available'} out of 100`}>
              <span className={`text-5xl font-semibold ${TONE_TEXT[tone]}`}>{latest.score !== null ? <CountUp value={latest.score} /> : '—'}</span>
              <span className="text-xs text-muted-foreground">out of 100</span>
            </ScoreRing>
            <div className="flex flex-col gap-2">
              <DeltaChip change={scoreChange} suffix="vs last audit" />
              {scored.length >= 2 ? (
                <div className="flex flex-col gap-1">
                  <Sparkline points={scored} tone={tone} width={170} height={44} label={`Score over the last ${scored.length} audits`} />
                  <span className="text-xs text-muted-foreground">Last {plural(scored.length, 'audit')}</span>
                </div>
              ) : (
                <span className="max-w-[12rem] text-xs text-muted-foreground">First measurement. A trend appears after the next audit.</span>
              )}
            </div>
          </div>
          <ul className="grid grid-cols-1 gap-2 border-t border-border pt-4 sm:grid-cols-2">
            {checks.map(({ type, finding }) => {
              const t = checkTone(finding?.status);
              const row = (
                <>
                  <span className="truncate">{CHECK_LABEL[type]}</span>
                  <StatusChip tone={t}>{finding ? CHECK_WORD[finding.status] : 'Not run'}</StatusChip>
                </>
              );
              // A failing check links straight to its fixes in the Fix Plan.
              return (
                <li key={type}>
                  {finding?.status === 'fail' ? (
                    <Link
                      href={`/client/projects/${projectId}/plan${FIX_GROUP[type] ? `?focus=${FIX_GROUP[type]}` : ''}`}
                      className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm transition-colors hover:bg-muted"
                      title="See how to fix this"
                    >
                      {row}
                    </Link>
                  ) : (
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </Tile>

        <Tile index={1}>
          <TileHeader icon={FileSearch} eyebrow="Pages checked" />
          <p className="text-4xl font-semibold">{crawled !== null ? <CountUp value={crawled} /> : '—'}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {num(inventory.discovered) !== null ? `of ${inventory.discovered} found in your sitemap` : 'across your sitemap'}
          </p>
        </Tile>

        <Tile index={2}>
          <TileHeader icon={Bot} eyebrow="Agent readiness" hint="How easily AI assistants and agents can use your site: things like llms.txt, clear structure and machine-readable actions." />
          <div className="flex items-center gap-4">
            <ScoreRing value={agentScore} tone={scoreTone(agentScore)} size={72} stroke={7} index={2} label={`Agent readiness ${agentScore ?? 'not available'} out of 100`}>
              <span className={`text-xl font-semibold ${TONE_TEXT[scoreTone(agentScore)]}`}>{agentScore ?? '—'}</span>
            </ScoreRing>
            <p className="text-sm text-muted-foreground">{str(agent.scoreLabel) ?? 'How easily AI assistants can use your site'}</p>
          </div>
        </Tile>

        <Tile index={3}>
          <TileHeader icon={Code} eyebrow="Structured data" hint="Hidden JSON-LD that tells machines who you are and what a page is about. AI engines lean on it to describe you accurately." />
          <div className="flex items-center gap-4">
            <ScoreRing value={jsonLdPct} tone={scoreTone(jsonLdPct)} size={72} stroke={7} index={3} label={`${jsonLdPct ?? 'Unknown'} percent of pages have structured data`}>
              <span className={`text-lg font-semibold ${TONE_TEXT[scoreTone(jsonLdPct)]}`}>{jsonLdPct !== null ? `${jsonLdPct}%` : '—'}</span>
            </ScoreRing>
            <p className="text-sm text-muted-foreground">
              {withJsonLd !== null && crawled !== null ? `${withJsonLd} of ${crawled} pages describe themselves to machines` : 'Not measured in this audit'}
            </p>
          </div>
        </Tile>

        <Tile index={4}>
          <TileHeader icon={Code} eyebrow="JavaScript rendering" hint="Most AI crawlers don't run JavaScript. Content that only appears after scripts run is invisible to them." />
          <StatusChip tone={jsDependent ? 'watch' : 'good'}>{jsDependent ? 'Needs JavaScript' : 'Server-rendered'}</StatusChip>
          <div className="mt-3 flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">Content hidden without JS</span>
              <span className="g-num font-medium">{contentLoss !== null ? `${Math.round(contentLoss)}%` : '—'}</span>
            </div>
            <Meter value={contentLoss} tone={contentLoss !== null && contentLoss > 20 ? 'watch' : 'good'} index={4} label="Content lost without JavaScript" />
          </div>
        </Tile>

        {/* PageSpeed */}
        <Tile index={5} className="md:col-span-2">
          <TileHeader icon={Zap} eyebrow="Page speed" title="Core Web Vitals" hint="Google's real-user speed measures: how fast the main content loads (LCP), how stable the layout is (CLS), and how quickly the page responds (INP)." />
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Loading', code: 'LCP', value: num(cwv.lcp), unit: 'ms' as const, status: str(cwv.lcpStatus) },
              { label: 'Stability', code: 'CLS', value: num(cwv.cls), unit: '' as const, status: str(cwv.clsStatus) },
              { label: 'Response', code: 'INP', value: num(cwv.inp), unit: 'ms' as const, status: str(cwv.inpStatus) },
            ].map((m) => {
              const t = cwvTone(m.status);
              return (
                <div key={m.code} className="flex flex-col gap-1 rounded-xl bg-muted/60 p-3">
                  <p className="text-xs text-muted-foreground">
                    {m.label} <span className="opacity-70">· {m.code}</span>
                  </p>
                  <p className={`g-num text-xl font-semibold ${TONE_TEXT[t]}`}>{formatMetric(m.value, m.unit)}</p>
                  {m.status ? <StatusChip tone={t}>{CWV_WORD[m.status] ?? m.status}</StatusChip> : null}
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-col gap-2.5">
            {categoryRows.map((row, i) => (
              <div key={row.key} className="grid grid-cols-[7.5rem_1fr_2.25rem] items-center gap-3 text-sm">
                <span className="text-muted-foreground">{row.label}</span>
                <Meter value={row.value} tone={scoreTone(row.value)} index={i} label={`${row.label} ${row.value ?? 'not measured'}`} />
                <span className="g-num text-right font-medium">{row.value ?? '—'}</span>
              </div>
            ))}
          </div>
          {failedAudits.length > 0 ? (
            <div className="mt-4 flex flex-col gap-1.5 border-t border-border pt-3">
              <p className="g-eyebrow">Biggest speed fixes</p>
              {failedAudits.slice(0, 4).map((audit) => (
                <div key={audit.title} className="flex items-baseline justify-between gap-3 text-sm">
                  <p className="truncate">{audit.title}</p>
                  <p className="g-num shrink-0 text-muted-foreground">{audit.displayValue}</p>
                </div>
              ))}
            </div>
          ) : null}
        </Tile>

        {/* Agent readiness detail */}
        <Tile index={6} className="md:col-span-2">
          <TileHeader icon={Bot} eyebrow="AI agents" title="What assistants need from your site" />
          <div className="mb-3 grid grid-cols-2 gap-2">
            {[
              ['Essential', breakdown.essential],
              ['Recommended', breakdown.recommended],
            ].map(([label, band]) => {
              const b = band as { passing?: number; total?: number } | undefined;
              return (
                <div key={label as string} className="flex flex-col gap-1.5 rounded-xl bg-muted/60 p-3">
                  <p className="text-xs text-muted-foreground">{label as string}</p>
                  <p className="g-num text-xl font-semibold">
                    {b?.passing ?? '—'}
                    <span className="text-sm font-normal text-muted-foreground">/{b?.total ?? '—'} passing</span>
                  </p>
                  {b?.total ? <Meter value={b.passing ?? 0} max={b.total} tone={scoreTone(((b.passing ?? 0) / b.total) * 100)} height={4} /> : null}
                </div>
              );
            })}
          </div>
          {agentIssues.length === 0 ? (
            <p className="text-sm text-muted-foreground">No agent-readiness issues in this audit.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {agentIssues.slice(0, 5).map((issue) => (
                <li key={issue.name} className="flex gap-2.5 py-2.5 text-sm">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                  <span className="flex flex-col">
                    <span className="font-medium">{issue.name}</span>
                    <span className="text-muted-foreground">{issue.recommendation}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Tile>

        {/* Page issues */}
        <Tile index={7} className="md:col-span-2">
          <TileHeader
            icon={ListChecks}
            eyebrow="Page issues"
            right={issues.length > 0 ? <span className="text-xs text-muted-foreground">{issues.reduce((n, [, c]) => n + c, 0)} hits</span> : null}
          />
          {issues.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CircleCheck className="size-4 text-success" /> No page issues found.
            </div>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {issues.slice(0, 8).map(([code, count], i) => (
                <li key={code} className="grid grid-cols-[minmax(0,1fr)_5rem_4.75rem] items-center gap-3 text-sm">
                  <span className="truncate">{ISSUE_LABEL[code] ?? code}</span>
                  <Meter value={count} max={maxIssue} tone="watch" height={4} index={i} />
                  <span className="g-num whitespace-nowrap text-right text-muted-foreground">{plural(count, 'page')}</span>
                </li>
              ))}
            </ul>
          )}
        </Tile>

        {/* Structure + changes */}
        <Tile index={8} className="md:col-span-2 p-0">
          <div className="px-5 pt-5">
            <TileHeader icon={FileSearch} eyebrow="Page structure" />
          </div>
          <ul className="flex flex-col pb-2">
            {structureRows.map(([label, count, hint]) => (
              <li key={label} className="flex items-center justify-between gap-3 border-t border-border px-5 py-2.5 text-sm first:border-t-0">
                <span>{label}</span>
                <span className="flex items-center gap-2">
                  {count === 0 ? <CircleCheck className="size-4 text-success" /> : count === null ? <Minus className="size-4 text-muted-foreground" /> : null}
                  <span className={`g-num font-medium ${count ? 'text-warning' : ''}`}>
                    {count ?? '—'}
                    {hint ? <span className="font-normal text-muted-foreground"> {hint}</span> : null}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Tile>

        {movers.length > 0 ? (
          <Tile index={9} className="md:col-span-4">
            <TileHeader icon={Clock} eyebrow="Since the last audit" />
            <ul className="grid gap-x-8 gap-y-2.5 md:grid-cols-2">
              {movers.slice(0, 8).map((d) => (
                <li key={d.metric} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{d.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="g-num text-muted-foreground">
                      {d.previous ?? '—'} → <span className="font-medium text-foreground">{d.current ?? '—'}</span>
                    </span>
                    <DeltaChip change={d.change} higherIsBetter={d.higherIsBetter} />
                  </span>
                </li>
              ))}
            </ul>
          </Tile>
        ) : null}
      </div>
    </PortalPage>
  );
}
