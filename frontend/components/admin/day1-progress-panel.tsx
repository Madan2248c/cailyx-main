'use client';

import { useEffect, useState } from 'react';
import { CircleCheck, CircleX, Clock, LoaderCircle, Minus } from 'lucide-react';
import { cn } from 'cn';
import { Meter } from '@/components/portal/charts';
import { computeDay1Progress, formatDuration, type StepState } from '@/lib/day1-progress';
import type { Day1Status } from '@/lib/settings-api';

/** A queued audit that hasn't started after this long usually means nothing is picking jobs up. */
const STALLED_QUEUE_MS = 90_000;

function StepIcon({ state }: { state: StepState }) {
  switch (state) {
    case 'done':
      return <CircleCheck aria-hidden className="size-4 shrink-0 text-success" />;
    case 'running':
      return <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-foreground motion-reduce:animate-none" />;
    case 'failed':
      return <CircleX aria-hidden className="size-4 shrink-0 text-danger" />;
    case 'skipped':
      return <Minus aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
    default:
      return <span aria-hidden className="m-[3px] size-2.5 shrink-0 rounded-full border border-border" />;
  }
}

const STATE_WORD: Record<StepState, string> = { done: 'done', running: 'in progress', failed: 'failed', skipped: 'skipped', waiting: 'waiting' };

/**
 * What the Day-1 audit is actually doing: each step and where it stands, how
 * far along, how long it has run, and a rough time left. The estimate says
 * "about" because it is one: it is seeded from typical step lengths and
 * corrected by how fast this run has really been going.
 */
export function Day1ProgressPanel({ day1 }: { day1: Day1Status }) {
  const active = day1.status === 'RUNNING' || day1.status === 'QUEUED';
  // A ticking clock, only while the audit is live, so "elapsed" moves without a refetch.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  const p = computeDay1Progress(day1, now);
  const queuedFor = day1.status === 'QUEUED' ? now - Date.parse(day1.createdAt) : 0;
  const stalled = day1.status === 'QUEUED' && queuedFor > STALLED_QUEUE_MS;
  const tone = day1.status === 'FAILED' ? 'bad' : day1.status === 'COMPLETE' ? 'good' : 'neutral';

  let summary: string;
  if (day1.status === 'COMPLETE') summary = p.elapsedSeconds !== null ? `Finished in ${formatDuration(p.elapsedSeconds).replace('about ', '')}.` : 'Finished.';
  else if (day1.status === 'FAILED') summary = 'Stopped. The failed step is marked below. Fix the cause, then retry.';
  else if (day1.status === 'QUEUED') summary = stalled ? 'Still waiting to start.' : `Starting shortly. A full run usually takes ${formatDuration(p.typicalTotalSeconds)}.`;
  else summary = p.etaSeconds !== null ? `${formatDuration(p.etaSeconds)} left (an estimate).` : 'Running.';

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-xl bg-muted/50 p-4" aria-label="Day-1 audit progress">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-semibold">
          {p.finished} of {p.total} steps <span className="g-num font-normal text-muted-foreground">· {p.percent}%</span>
        </p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status" aria-live="polite">
          <Clock aria-hidden className="size-3.5" />
          {p.elapsedSeconds !== null && active ? `${formatDuration(p.elapsedSeconds).replace('about ', '')} elapsed · ` : ''}
          {summary}
        </p>
      </div>

      <Meter value={p.percent} tone={tone} height={6} label={`Day-1 audit ${p.percent}% complete`} />

      {stalled ? (
        <p role="alert" className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-foreground">
          This has been queued for over a minute and has not started. The job queue may not be running (check that Redis is up), or every worker is busy. Use
          &ldquo;Retry Day-1&rdquo; once it is back.
        </p>
      ) : null}

      <ol className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {p.steps.map((step, i) => (
          <li key={step.key} className="flex items-start gap-2 text-sm">
            <StepIcon state={step.state} />
            <span className="min-w-0">
              <span className={cn(step.state === 'waiting' && 'text-muted-foreground', step.state === 'running' && 'font-medium')}>
                {i + 1}. {step.label}
              </span>
              <span className="sr-only"> ({STATE_WORD[step.state]})</span>
              {step.detail && (step.state === 'failed' || step.state === 'skipped') ? (
                <span className={cn('line-clamp-2 block text-xs', step.state === 'failed' ? 'text-danger' : 'text-muted-foreground')} title={step.detail}>
                  {step.state === 'skipped' ? `Skipped: ${step.detail}` : step.detail}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
