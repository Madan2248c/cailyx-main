'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listTechnicalAuditRuns } from '@/lib/technical-api';
import type { TechnicalAuditRun } from '@/types/technical';
import { ISSUE_LABEL, type PageIssueCode } from '@/types/technical';

function num(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function str(raw: unknown): string | null {
  return typeof raw === 'string' ? raw : null;
}

function scoreTone(score: number | null): { text: string; bar: string } {
  if (score === null) return { text: 'text-muted-foreground', bar: 'bg-muted-foreground' };
  if (score >= 80) return { text: 'text-green-600', bar: 'bg-green-500' };
  if (score >= 50) return { text: 'text-amber-600', bar: 'bg-amber-500' };
  return { text: 'text-red-600', bar: 'bg-red-500' };
}

function cwvTone(status: string | null): string {
  if (status === 'good') return 'bg-green-500';
  if (status === 'needs-improvement') return 'bg-amber-500';
  if (status === 'poor') return 'bg-red-500';
  return 'bg-muted-foreground/40';
}

function formatMetric(value: number | null, unit: 'ms' | '' | 's'): string {
  if (value === null) return '—';
  if (unit === 's') return `${value.toFixed(2)} s`;
  if (unit === 'ms') return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
  return String(Math.round(value * 100) / 100);
}

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

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, projectId]);

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!runs) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading technical audit…</p>
      </div>
    );
  }

  const latest = runs.find((r) => r.status === 'COMPLETE') ?? null;
  const pending = runs.find((r) => r.status === 'QUEUED' || r.status === 'RUNNING') ?? null;

  if (!latest) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6">
        <h1 className="text-2xl font-semibold">Technical</h1>
        <p className="mt-1 text-sm text-muted-foreground">{projectName}</p>
        <Card className="mt-4">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {pending
                ? 'An audit is running right now — check back when it completes.'
                : 'No completed audit yet. One runs automatically as part of your Day-1 pipeline.'}
            </p>
          </CardContent>
        </Card>
      </div>
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
  const agentScore = num(agent.score);
  const tone = scoreTone(latest.score);
  const jsRender = findingsByType.get('js-render')?.detail ?? {};
  const jsDependent = jsRender.isJsDependent === true;
  const contentLoss = num(jsRender.contentLossPercent);

  const structureRows: Array<[string, number | null, string | null]> = [
    ['Pages with bad titles', num(inventory.pagesWithBadTitle), null],
    ['Pages with bad meta descriptions', num(inventory.pagesWithBadMeta), null],
    ['Thin content pages', num(inventory.pagesThin), null],
    ['Pages with heading issues', num(inventory.pagesWithHeadingIssues), null],
    [
      'Images missing alt text',
      num(inventory.imagesMissingAlt),
      num(inventory.imagesTotal) !== null ? `of ${inventory.imagesTotal} images` : null,
    ],
    ['Pages with duplicate content', num(inventory.pagesWithDuplicateContent), null],
    ['Pages with bad canonical tags', num(inventory.pagesWithBadCanonical), null],
  ];

  const issueCounts = (inventory.issueCounts ?? {}) as Record<string, number>;
  const issues = (Object.entries(issueCounts) as Array<[PageIssueCode, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  const categories = (cwv.categories ?? {}) as Record<string, number>;
  const categoryRows = ['performance', 'seo', 'accessibility', 'best-practices'].map((key) => ({
    key,
    label: key.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    value: num(categories[key]),
  }));
  const failedAudits = (Array.isArray(cwv.failedAudits) ? cwv.failedAudits : []) as Array<{
    title: string;
    displayValue: string;
  }>;
  const agentIssues = (Array.isArray(agent.issues) ? agent.issues : []) as Array<{
    name: string;
    recommendation: string;
  }>;
  const essential = agent.breakdown && typeof agent.breakdown === 'object'
    ? (agent.breakdown as { essential?: { passing?: number; total?: number }; recommended?: { passing?: number; total?: number } }).essential
    : undefined;
  const recommended = agent.breakdown && typeof agent.breakdown === 'object'
    ? (agent.breakdown as { essential?: { passing?: number; total?: number }; recommended?: { passing?: number; total?: number } }).recommended
    : undefined;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Technical</h1>
        <p className="text-sm text-muted-foreground">
          {projectName} · audited {new Date(latest.completedAt ?? latest.createdAt).toLocaleDateString()}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="flex flex-col gap-2 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Site score</p>
            <p className={`text-4xl font-semibold ${tone.text}`}>
              {latest.score ?? '—'}
              <span className="text-base font-normal text-muted-foreground">/100</span>
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${latest.score ?? 0}%` }} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-2 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Pages checked</p>
            <p className="text-4xl font-semibold">{crawled ?? '—'}</p>
            <p className="text-xs text-muted-foreground">
              {num(inventory.discovered) !== null ? `of ${inventory.discovered} discovered` : 'across your sitemap'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-2 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Pages with JSON-LD</p>
            <p className="text-4xl font-semibold">
              {withJsonLd ?? '—'}
              {crawled !== null && crawled > 0 && withJsonLd !== null ? (
                <span className="text-base font-normal text-muted-foreground">
                  /{crawled} · {Math.round((withJsonLd / crawled) * 100)}%
                </span>
              ) : null}
            </p>
            <p className="text-xs text-muted-foreground">valid structured data</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-2 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Agent readiness</p>
            <p className={`text-4xl font-semibold ${scoreTone(agentScore).text}`}>
              {agentScore ?? '—'}
              {agentScore !== null ? <span className="text-base font-normal text-muted-foreground">/100</span> : null}
            </p>
            <p className="text-xs text-muted-foreground">{str(agent.scoreLabel) ?? 'AI crawler scan'}</p>
          </CardContent>
        </Card>
      </div>

      <div className="columns-1 gap-4 lg:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">PageSpeed Insights</CardTitle>
            <CardDescription>Core Web Vitals for your homepage</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'LCP', value: num(cwv.lcp), unit: 'ms' as const, status: str(cwv.lcpStatus) },
                { label: 'CLS', value: num(cwv.cls), unit: '' as const, status: str(cwv.clsStatus) },
                { label: 'INP', value: num(cwv.inp), unit: 'ms' as const, status: str(cwv.inpStatus) },
              ].map((m) => (
                <div key={m.label} className="flex flex-col gap-1 rounded-lg border border-border p-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`size-2 rounded-full ${cwvTone(m.status)}`} />
                    <p className="text-xs font-medium text-muted-foreground">{m.label}</p>
                  </div>
                  <p className="text-lg font-semibold">{formatMetric(m.value, m.unit)}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              {categoryRows.map((row) => (
                <div key={row.key} className="flex items-center gap-2 text-sm">
                  <p className="w-28 shrink-0 text-muted-foreground">{row.label}</p>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${scoreTone(row.value).bar}`}
                      style={{ width: `${row.value ?? 0}%` }}
                    />
                  </div>
                  <p className="w-8 shrink-0 text-right font-medium">{row.value ?? '—'}</p>
                </div>
              ))}
            </div>
            {failedAudits.length > 0 ? (
              <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                <p className="text-xs font-medium text-muted-foreground">Failing Lighthouse audits</p>
                {failedAudits.slice(0, 5).map((audit) => (
                  <div key={audit.title} className="flex items-baseline justify-between gap-3 text-sm">
                    <p className="truncate">{audit.title}</p>
                    <p className="shrink-0 text-muted-foreground">{audit.displayValue}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agent readiness</CardTitle>
            <CardDescription>How easily AI crawlers and assistants use your site</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex gap-4">
              {essential ? (
                <p>
                  <span className="font-semibold">{essential.passing ?? '—'}/{essential.total ?? '—'}</span>{' '}
                  <span className="text-muted-foreground">essential</span>
                </p>
              ) : null}
              {recommended ? (
                <p>
                  <span className="font-semibold">{recommended.passing ?? '—'}/{recommended.total ?? '—'}</span>{' '}
                  <span className="text-muted-foreground">recommended</span>
                </p>
              ) : null}
              {agentIssues.length === 0 && !essential && !recommended ? (
                <p className="text-muted-foreground">No agent-readiness data in this audit.</p>
              ) : null}
            </div>
            {agentIssues.slice(0, 6).map((issue) => (
              <div key={issue.name} className="flex flex-col gap-0.5 rounded-lg border border-border p-2.5">
                <p className="font-medium">{issue.name}</p>
                <p className="text-muted-foreground">{issue.recommendation}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Page structure</CardTitle>
            <CardDescription>Headings, titles, and content quality across checked pages</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col p-0">
            {structureRows.map(([label, count, hint], i) => (
              <div
                key={label}
                className={`flex items-baseline justify-between gap-3 px-6 py-2.5 text-sm ${i > 0 ? 'border-t border-border' : ''}`}
              >
                <p>{label}</p>
                <p className="shrink-0 font-medium">
                  {count ?? '—'}
                  {hint ? <span className="font-normal text-muted-foreground"> {hint}</span> : null}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">JavaScript rendering</CardTitle>
            <CardDescription>Whether your content needs JavaScript to appear</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${jsDependent ? 'bg-amber-500' : 'bg-green-500'}`} />
              <p className="font-medium">
                {jsDependent ? 'Content depends on JavaScript' : 'Fully server-rendered'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <p className="w-36 shrink-0 text-muted-foreground">Content lost without JS</p>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${contentLoss !== null && contentLoss > 20 ? 'bg-amber-500' : 'bg-green-500'}`}
                  style={{ width: `${contentLoss ?? 0}%` }}
                />
              </div>
              <p className="w-12 shrink-0 text-right font-medium">
                {contentLoss !== null ? `${Math.round(contentLoss)}%` : '—'}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Search engines and AI crawlers see far less of pages that only render in the browser.
            </p>
          </CardContent>
        </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Issues</CardTitle>
          <CardDescription>
            {issues.length === 0 ? 'No page issues found.' : `${issues.reduce((n, [, c]) => n + c, 0)} page-level hits across ${issues.length} issue types.`}
          </CardDescription>
        </CardHeader>
        {issues.length > 0 ? (
          <CardContent className="flex flex-col p-0">
            {issues.map(([code, count], i) => (
              <div
                key={code}
                className={`flex items-baseline justify-between gap-3 px-6 py-2.5 text-sm ${i > 0 ? 'border-t border-border' : ''}`}
              >
                <p>{ISSUE_LABEL[code] ?? code}</p>
                <p className="shrink-0 font-medium text-primary">
                  {count} {count === 1 ? 'page' : 'pages'}
                </p>
              </div>
            ))}
          </CardContent>
        ) : null}
      </Card>

      {movers.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Since the last audit</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-2 text-sm">
              {movers.slice(0, 8).map((d) => (
                <div key={d.metric} className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">{d.label}</dt>
                  <dd className="flex shrink-0 items-baseline gap-1.5">
                    <span className="text-muted-foreground">
                      {d.previous ?? '—'} → {d.current ?? '—'}
                    </span>
                    <span
                      className={
                        d.direction === 'improved'
                          ? 'font-medium text-green-600'
                          : d.direction === 'regressed'
                            ? 'font-medium text-red-600'
                            : 'text-muted-foreground'
                      }
                    >
                      {d.direction === 'improved' ? '▲' : d.direction === 'regressed' ? '▼' : '●'}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ) : null}
      </div>
    </div>
  );
}
