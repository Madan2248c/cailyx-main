'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getAeoVerdict, listAeoAudits } from '@/lib/aeo-api';
import type { AeoVerdict, Stance } from '@/types/aeo';
import { STANCE_LABEL, SURFACE_LABEL } from '@/types/aeo';

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

const STANCE_ORDER: Stance[] = [
  'recommended_primary',
  'recommended_alternative',
  'mentioned_neutral',
  'mentioned_negative',
  'absent',
];

export function AiTab({
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
  const [verdict, setVerdict] = useState<AeoVerdict | null>(null);
  const [auditDate, setAuditDate] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'empty' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    listAeoAudits(accessToken, clientId, projectId)
      .then((audits) => {
        const done = audits.filter((a) => a.status === 'completed');
        if (cancelled) return null;
        if (done.length === 0) {
          setState('empty');
          return null;
        }
        const latest = done.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        setAuditDate(latest.finishedAt ?? latest.createdAt);
        return getAeoVerdict(accessToken, clientId, latest.id);
      })
      .then((result) => {
        if (!cancelled && result) {
          setVerdict(result);
          setState('ready');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load the audit');
          setState('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, projectId]);

  if (state === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading AI visibility…</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (state === 'empty' || !verdict) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6">
        <h1 className="text-2xl font-semibold">AI visibility</h1>
        <p className="mt-1 text-sm text-muted-foreground">{projectName}</p>
        <Card className="mt-4">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              No completed answer-engine audit yet. One runs automatically as part of your Day-1 pipeline.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const overall = verdict.counted.overall;
  const judgedTotal = verdict.judged
    ? Object.values(verdict.judged.stanceCounts).reduce((n, c) => n + c, 0)
    : 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">AI visibility</h1>
        <p className="text-sm text-muted-foreground">
          {projectName}
          {auditDate ? ` · audited ${new Date(auditDate).toLocaleDateString()}` : ''}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Mention rate</p>
            <p className="text-4xl font-semibold">{pct(overall.mentionRate)}</p>
            <p className="text-xs text-muted-foreground">named in answers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Citation rate</p>
            <p className="text-4xl font-semibold">{pct(overall.citationRate)}</p>
            <p className="text-xs text-muted-foreground">linked as a source</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Answers judged</p>
            <p className="text-4xl font-semibold">{overall.observations.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">across {verdict.counted.bySurface.length} engines</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <p className="text-xs font-medium text-muted-foreground">Recommended first</p>
            <p className="text-4xl font-semibold">
              {verdict.judged ? (verdict.judged.stanceCounts.recommended_primary ?? 0) : '—'}
            </p>
            <p className="text-xs text-muted-foreground">times as the top pick</p>
          </CardContent>
        </Card>
      </div>

      {verdict.headlines.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Headlines</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {verdict.headlines.map((headline) => (
              <p key={headline.slice(0, 48)} className="text-sm">
                {headline}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By answer engine</CardTitle>
            <CardDescription>Mention and citation rates per surface</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {verdict.counted.bySurface.map((slice) => (
              <div key={slice.surface} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between text-sm">
                  <p className="font-medium">{SURFACE_LABEL[slice.surface] ?? slice.surface}</p>
                  <p className="text-muted-foreground">
                    {pct(slice.mentionRate)} mentioned · {pct(slice.citationRate)} cited
                  </p>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(slice.mentionRate * 100)}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">How engines position you</CardTitle>
            <CardDescription>Stance of every judged answer</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {!verdict.judged || judgedTotal === 0 ? (
              <p className="text-sm text-muted-foreground">No stance judgments in this audit.</p>
            ) : (
              STANCE_ORDER.map((stance) => {
                const count = verdict.judged?.stanceCounts[stance] ?? 0;
                return (
                  <div key={stance} className="flex items-center gap-2 text-sm">
                    <p className="w-44 shrink-0 text-muted-foreground">{STANCE_LABEL[stance]}</p>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.round((count / judgedTotal) * 100)}%` }}
                      />
                    </div>
                    <p className="w-8 shrink-0 text-right font-medium">{count}</p>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Against rivals</CardTitle>
            <CardDescription>Head-to-head across judged answers</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col p-0">
            {verdict.counted.competitorStanding.length === 0 ? (
              <p className="px-6 py-4 text-sm text-muted-foreground">No rival co-mentions in this audit.</p>
            ) : (
              verdict.counted.competitorStanding.slice(0, 8).map((row, i) => (
                <div
                  key={row.name}
                  className={`flex items-center gap-3 px-6 py-2.5 text-sm ${i > 0 ? 'border-t border-border' : ''}`}
                >
                  <p className="min-w-0 flex-1 truncate font-medium">{row.name}</p>
                  <p className="shrink-0 text-muted-foreground">
                    <span className="font-medium text-green-600">{row.timesAhead}</span> ahead ·{' '}
                    <span className="font-medium text-red-600">{row.timesBehind}</span> behind
                    {row.coMentions > 0 ? <span> · {row.coMentions} tied</span> : null}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Where you lose</CardTitle>
            <CardDescription>Prompts that recommend a rival instead</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            {!verdict.judged || verdict.judged.losingPrompts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No losing prompts in this audit.</p>
            ) : (
              verdict.judged.losingPrompts.slice(0, 5).map((row) => (
                <div key={row.observationId} className="flex flex-col gap-0.5 text-sm">
                  <p className="truncate font-medium" title={row.prompt}>
                    {row.prompt}
                  </p>
                  <p className="text-muted-foreground">
                    Loses to {row.losesTo.join(', ')}
                    {row.losesTo.length === 0 ? 'an unnamed rival' : ''}
                  </p>
                </div>
              ))
            )}
            {verdict.judged && verdict.judged.winningPrompts.length > 0 ? (
              <div className="flex items-center gap-2 border-t border-border pt-2.5 text-sm">
                <Badge variant="secondary">{verdict.judged.winningPrompts.length} wins</Badge>
                <p className="truncate text-muted-foreground">{verdict.judged.winningPrompts[0].prompt}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
