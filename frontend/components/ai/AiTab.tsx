'use client';

import { useEffect, useState } from 'react';
import { CircleCheck, Layers, MessageSquareQuote, Radar, Sparkles, Swords, Target, TriangleAlert } from 'lucide-react';
import { HeadToHead, Meter, ScoreRing, StackedBar, type Segment } from '@/components/portal/charts';
import { MetaDot, PageHeader, PortalPage, Tile, TileHeader } from '@/components/portal/layout';
import { CountUp } from '@/components/portal/motion';
import { EmptyState, ErrorState, PortalLoading } from '@/components/portal/states';
import { formatDate, pct, plural, rateTone, TONE_TEXT } from '@/components/portal/tone';
import { Tabs, TabsContent, TabsContents, TabsList, TabsTrigger } from '@/components/animate-ui/components/animate/tabs';
import { getAeoVerdict, listAeoAudits } from '@/lib/aeo-api';
import type { AeoVerdict, Stance } from '@/types/aeo';
import { STANCE_LABEL, SURFACE_LABEL } from '@/types/aeo';

const STANCE_ORDER: Stance[] = [
  'recommended_primary',
  'recommended_alternative',
  'mentioned_neutral',
  'mentioned_negative',
  'absent',
];

/** Best to worst, dark-to-light within each meaning, so the bar reads left to right. */
const STANCE_COLOR: Record<Stance, string> = {
  recommended_primary: 'var(--success)',
  recommended_alternative: 'color-mix(in oklab, var(--success) 55%, white)',
  mentioned_neutral: 'var(--g-ink-muted)',
  mentioned_negative: 'var(--danger)',
  absent: 'var(--g-line-strong)',
};

const FUNNEL_LABEL: Record<string, string> = {
  awareness: 'Awareness',
  consideration: 'Consideration',
  decision: 'Decision',
  retention: 'Retention',
  tofu: 'Top of funnel',
  mofu: 'Middle of funnel',
  bofu: 'Bottom of funnel',
};

function engineName(surface: string): string {
  return SURFACE_LABEL[surface] ?? surface;
}

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

  if (state === 'loading') return <PortalLoading label="Loading AI visibility" />;
  if (state === 'error') return <ErrorState message={error ?? 'Failed to load the audit'} />;

  if (state === 'empty' || !verdict) {
    return (
      <PortalPage>
        <PageHeader eyebrow="Performance" title="AI visibility" meta={<span>{projectName}</span>} />
        <Tile index={1}>
          <EmptyState
            title="Not measured yet"
            body="Your first answer-engine audit runs in the Day-1 pipeline. We ask ChatGPT, Perplexity and Gemini the questions your buyers ask, then show how often they name you."
          />
        </Tile>
      </PortalPage>
    );
  }

  const overall = verdict.counted.overall;
  const judged = verdict.judged;
  const judgedTotal = judged ? Object.values(judged.stanceCounts).reduce((n, c) => n + c, 0) : 0;
  const firstPicks = judged?.stanceCounts.recommended_primary ?? 0;
  const engines = [...verdict.counted.bySurface].sort((a, b) => b.mentionRate - a.mentionRate);
  const bestEngine = engines[0] ?? null;
  const rivals = verdict.counted.competitorStanding.slice(0, 8);
  const h2hScale = Math.max(1, ...rivals.map((r) => Math.max(r.timesAhead, r.timesBehind)));
  const funnel = verdict.counted.byFunnelStage;

  const segments: Segment[] = STANCE_ORDER.map((stance) => ({
    key: stance,
    label: STANCE_LABEL[stance],
    value: judged?.stanceCounts[stance] ?? 0,
    color: STANCE_COLOR[stance],
  }));

  const summary =
    `AI engines name ${projectName} in ${pct(overall.mentionRate)} of the answers we tested` +
    (firstPicks > 0 ? `, and recommend you first ${plural(firstPicks, 'time')}.` : '.') +
    (bestEngine && engines.length > 1 ? ` ${engineName(bestEngine.surface)} knows you best.` : '');

  return (
    <PortalPage>
      <PageHeader
        eyebrow="Performance"
        title="AI visibility"
        meta={
          <>
            <span>{projectName}</span>
            {auditDate ? (
              <>
                <MetaDot />
                <span>Measured {formatDate(auditDate)}</span>
              </>
            ) : null}
            <MetaDot />
            <span>
              {overall.observations.toLocaleString()} answers from {plural(verdict.counted.bySurface.length, 'engine')}
            </span>
          </>
        }
        summary={summary}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {/* Hero: the two rates that define visibility */}
        <Tile ink index={0} className="md:col-span-2 gap-5 p-6">
          <TileHeader icon={Sparkles} eyebrow="How often AI names you" hint="Mentioned: the answer names your company. Cited: the answer links to your site as a source, which usually drives visits." />
          <div className="grid grid-cols-2 gap-6">
            <RateRing label="Mentioned" hint="named in the answer" rate={overall.mentionRate} index={0} />
            <RateRing label="Cited" hint="linked as a source" rate={overall.citationRate} index={1} />
          </div>
          <p className="mt-auto border-t border-white/10 pt-4 text-sm text-white/65">
            Rates, not positions: AI answers change from run to run, so we measure how often you appear across many answers rather than a single ranking.
          </p>
        </Tile>

        <Tile index={1}>
          <TileHeader icon={Target} eyebrow="Recommended first" hint="Answers where the engine put you forward as its top pick, not just a mention in a list." />
          <p className="text-4xl font-semibold text-success">
            <CountUp value={firstPicks} />
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {judgedTotal > 0 ? `of ${judgedTotal.toLocaleString()} judged answers put you first` : 'No stance judgments in this audit'}
          </p>
          {judgedTotal > 0 ? (
            <div className="mt-auto pt-3">
              <Meter value={firstPicks} max={judgedTotal} tone="good" index={2} label={`${firstPicks} of ${judgedTotal} answers`} />
            </div>
          ) : null}
        </Tile>

        <Tile index={2}>
          <TileHeader icon={Radar} eyebrow="Unprompted" hint="Questions that don't include your name, like &quot;best tool for X&quot;. This is how new buyers find you, so it matters most." />
          {verdict.counted.unbranded ? (
            <>
              <p className={`text-4xl font-semibold ${TONE_TEXT[rateTone(verdict.counted.unbranded.mentionRate)]}`}>
                <CountUp value={Math.round(verdict.counted.unbranded.mentionRate * 100)} suffix="%" />
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                of questions that don&apos;t name you still bring you up
                {verdict.counted.branded ? `, versus ${pct(verdict.counted.branded.mentionRate)} when buyers ask by name` : ''}.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">This audit didn&apos;t split branded and unbranded questions.</p>
          )}
        </Tile>

        {/* Engines */}
        <Tile index={3} className="md:col-span-2">
          <TileHeader icon={Layers} eyebrow="By answer engine" />
          <ul className="flex flex-col gap-3.5">
            {engines.map((slice, i) => (
              <li key={slice.surface} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{engineName(slice.surface)}</span>
                  <span className="g-num text-muted-foreground">
                    <span className="font-medium text-foreground">{pct(slice.mentionRate)}</span> mentioned · {pct(slice.citationRate)} cited
                  </span>
                </div>
                <Meter value={slice.mentionRate * 100} tone={rateTone(slice.mentionRate)} index={i} label={`${engineName(slice.surface)} mention rate ${pct(slice.mentionRate)}`} />
              </li>
            ))}
          </ul>
        </Tile>

        {/* Stance */}
        <Tile index={4} className="md:col-span-2">
          <TileHeader icon={MessageSquareQuote} eyebrow="How AI talks about you" hint="How each judged answer positioned you, from recommended first through to not mentioned at all." />
          {judged && judgedTotal > 0 ? (
            <StackedBar segments={segments} label={`Stance across ${judgedTotal} judged answers`} />
          ) : (
            <p className="text-sm text-muted-foreground">No stance judgments in this audit.</p>
          )}
        </Tile>

        {/* Rivals */}
        <Tile index={5} className="md:col-span-2">
          <TileHeader
            icon={Swords}
            eyebrow="Head to head"
            hint="In answers that mention both of you, how often each side came out ahead."
            right={
              rivals.length > 0 ? (
                <span className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-danger" />They win</span>
                  <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-success" />You win</span>
                </span>
              ) : null
            }
          />
          {rivals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rivals appeared next to you in this audit.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {rivals.map((row, i) => (
                <li key={row.name} className="grid grid-cols-[minmax(0,7rem)_2rem_1fr_2rem] items-center gap-2 text-sm">
                  <span className="truncate font-medium" title={row.name}>{row.name}</span>
                  <span className="g-num text-right text-danger">{row.timesBehind}</span>
                  <HeadToHead
                    ahead={row.timesAhead}
                    behind={row.timesBehind}
                    scale={h2hScale}
                    index={i}
                    label={`Versus ${row.name}: you win ${row.timesAhead}, they win ${row.timesBehind}`}
                  />
                  <span className="g-num text-success">{row.timesAhead}</span>
                </li>
              ))}
            </ul>
          )}
        </Tile>

        {/* Funnel */}
        <Tile index={6} className="md:col-span-2">
          <TileHeader icon={Target} eyebrow="Across the buyer journey" hint="Awareness questions are early research, decision questions are close to buying. Visibility late in the journey converts best." />
          {funnel.length === 0 ? (
            <p className="text-sm text-muted-foreground">No funnel-stage breakdown in this audit.</p>
          ) : (
            <ul className="flex flex-col gap-3.5">
              {funnel.map((stage, i) => (
                <li key={stage.funnelStage} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{FUNNEL_LABEL[stage.funnelStage.toLowerCase()] ?? stage.funnelStage}</span>
                    <span className="g-num text-muted-foreground">
                      <span className="font-medium text-foreground">{pct(stage.mentionRate)}</span> of {stage.observations}
                    </span>
                  </div>
                  <Meter value={stage.mentionRate * 100} tone={rateTone(stage.mentionRate)} index={i} label={`${stage.funnelStage}: ${pct(stage.mentionRate)}`} />
                </li>
              ))}
            </ul>
          )}
        </Tile>

        {/* Where you lose / win: one tile, Animate UI sliding tabs */}
        <Tile index={7} className={verdict.headlines.length > 0 ? 'md:col-span-2' : 'md:col-span-4'}>
          <TileHeader
            icon={MessageSquareQuote}
            eyebrow="Buyer questions"
            hint="Real questions your buyers ask AI assistants. 'Lost' means an engine recommended a rival instead of you; 'won' means you were recommended first."
          />
          <Tabs defaultValue={judged && judged.losingPrompts.length === 0 && judged.winningPrompts.length > 0 ? 'won' : 'lost'}>
            <TabsList className="w-full">
              <TabsTrigger value="lost">
                <TriangleAlert className="size-3.5 text-danger" /> Lost to rivals
                <span className="g-num text-xs text-muted-foreground">{judged?.losingPrompts.length ?? 0}</span>
              </TabsTrigger>
              <TabsTrigger value="won">
                <CircleCheck className="size-3.5 text-success" /> Won
                <span className="g-num text-xs text-muted-foreground">{judged?.winningPrompts.length ?? 0}</span>
              </TabsTrigger>
            </TabsList>
            <TabsContents>
              <TabsContent value="lost">
                {!judged || judged.losingPrompts.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">No questions lost to a rival in this audit.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {judged.losingPrompts.slice(0, 6).map((row) => (
                      <li key={row.observationId} className="flex flex-col gap-0.5 py-2.5">
                        <p className="truncate text-sm font-medium" title={row.prompt}>“{row.prompt}”</p>
                        <p className="text-xs text-muted-foreground">
                          AI recommends <span className="text-danger">{row.losesTo.length > 0 ? row.losesTo.join(', ') : 'a rival'}</span> instead
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
              <TabsContent value="won">
                {!judged || judged.winningPrompts.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">No first-place recommendations yet. This is where progress shows up first.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {judged.winningPrompts.slice(0, 6).map((row) => (
                      <li key={row.observationId} className="flex items-center gap-2.5 py-2.5 text-sm">
                        <CircleCheck className="size-4 shrink-0 text-success" />
                        <span className="truncate" title={row.prompt}>“{row.prompt}”</span>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            </TabsContents>
          </Tabs>
        </Tile>

        {verdict.headlines.length > 0 ? (
          <Tile index={8} className="md:col-span-2">
            <TileHeader icon={Sparkles} eyebrow="In short" />
            <ul className="flex flex-col gap-3">
              {verdict.headlines.map((headline) => (
                <li key={headline.slice(0, 48)} className="flex gap-3 text-sm">
                  <span className="mt-2 h-px w-4 shrink-0 bg-foreground/40" />
                  <span>{headline}</span>
                </li>
              ))}
            </ul>
          </Tile>
        ) : null}
      </div>
    </PortalPage>
  );
}

function RateRing({ label, hint, rate, index }: { label: string; hint: string; rate: number; index: number }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
      <ScoreRing value={Math.round(rate * 100)} tone="neutral" onInk size={104} stroke={9} index={index} label={`${label} in ${pct(rate)} of answers`}>
        <span className="text-3xl font-semibold text-white">
          <CountUp value={Math.round(rate * 100)} suffix="%" />
        </span>
      </ScoreRing>
      <div className="flex flex-col">
        <span className="text-base font-semibold text-white">{label}</span>
        <span className="text-sm text-white/60">{hint}</span>
      </div>
    </div>
  );
}
