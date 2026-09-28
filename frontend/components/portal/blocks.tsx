'use client';

import { CircleCheck } from 'lucide-react';
import { cn } from 'cn';
import { Hint } from './hint';
import { PageHeader, PortalPage, Tile, TileHeader } from './layout';
import { Num } from './motion';
import { EmptyState } from './states';
import { TONE_COLOR, TONE_SOFT, TONE_TEXT, type Tone } from './tone';

/**
 * Building blocks shared by every portal tab, so each page reads the same
 * way: header, a row of stat tiles, "what to do next", then the detail.
 */

/** One number with a label above and a plain-language caption below. */
export function Stat({
  label,
  value,
  unit,
  caption,
  tone = 'neutral',
  hint,
  index = 0,
}: {
  label: string;
  value: number | string | null;
  /** Small trailing text after the number ("of 12", "%"). */
  unit?: string;
  caption?: React.ReactNode;
  tone?: Tone;
  hint?: React.ReactNode;
  index?: number;
}) {
  return (
    <Tile index={index} className="gap-1.5">
      <div className="flex items-center gap-1.5">
        <p className="g-eyebrow">{label}</p>
        {hint ? <Hint label={`About ${label.toLowerCase()}`}>{hint}</Hint> : null}
      </div>
      <p className={cn('g-num text-3xl font-semibold leading-tight', TONE_TEXT[tone])}>
        {value === null ? <span className="text-muted-foreground">Not yet</span> : <Num value={value} />}
        {unit && value !== null ? <span className="ml-1 text-base font-normal text-muted-foreground">{unit}</span> : null}
      </p>
      {caption ? <p className="text-sm text-muted-foreground">{caption}</p> : null}
    </Tile>
  );
}

/** A row of Stat tiles that wraps cleanly from 1 to `cols` columns. */
export function StatRow({ children, cols = 3 }: { children: React.ReactNode; cols?: 2 | 3 | 4 }) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4 sm:grid-cols-2',
        cols === 3 && 'lg:grid-cols-3',
        cols === 4 && 'lg:grid-cols-4',
      )}
    >
      {children}
    </div>
  );
}

/**
 * A titled tile for a block of detail. `flush` removes the body padding so a
 * table or list can run edge to edge.
 */
export function Section({
  icon,
  eyebrow,
  title,
  description,
  hint,
  right,
  flush = false,
  index = 0,
  className,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  eyebrow: string;
  title?: string;
  description?: React.ReactNode;
  hint?: React.ReactNode;
  right?: React.ReactNode;
  flush?: boolean;
  index?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tile index={index} className={cn(flush && 'p-0', className)}>
      <div className={cn(flush && 'px-5 pt-5')}>
        <TileHeader icon={icon} eyebrow={eyebrow} title={title} hint={hint} right={right} />
        {description ? <p className="-mt-1 mb-3 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </Tile>
  );
}

export interface NextStep {
  tone: Tone;
  /** The short bold lead: what happened, in a few words. */
  lead: string;
  /** What to do about it. */
  text?: React.ReactNode;
}

/**
 * "What to do next": the page's findings as a short list, worst first. Each
 * item leads with a bold phrase so the page scans in seconds.
 */
export function NextSteps({
  items,
  allClear,
  index = 0,
  title = 'What to do next',
}: {
  items: NextStep[];
  /** Shown with a check when there is nothing to do. */
  allClear: string;
  index?: number;
  title?: string;
}) {
  return (
    <Tile index={index}>
      <TileHeader eyebrow={title} right={items.length > 1 ? <span className="text-xs text-muted-foreground">Most important first</span> : null} />
      {items.length === 0 ? (
        <p className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <CircleCheck className="size-5 shrink-0 text-success" aria-hidden />
          {allClear}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.lead} className="flex items-start gap-3 text-sm">
              <span
                aria-hidden
                className="mt-1 flex size-4 shrink-0 items-center justify-center rounded-full"
                style={{ background: TONE_SOFT[item.tone] }}
              >
                <span className="size-1.5 rounded-full" style={{ background: TONE_COLOR[item.tone] }} />
              </span>
              <p className="min-w-0 leading-relaxed">
                <span className="font-semibold text-foreground">{item.lead}</span>
                {item.text ? <span className="text-muted-foreground"> {item.text}</span> : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

/**
 * A whole page that has nothing to show yet: the usual header, then one
 * tile that says what this page will show and what happens next.
 */
export function EmptyPage({
  eyebrow,
  title,
  projectName,
  emptyTitle,
  body,
  steps,
}: {
  eyebrow: string;
  title: string;
  projectName: string;
  emptyTitle: string;
  body: React.ReactNode;
  /** Short "what happens next" steps, in order. */
  steps?: string[];
}) {
  return (
    <PortalPage>
      <PageHeader eyebrow={eyebrow} title={title} meta={<span>{projectName}</span>} />
      <Tile index={1}>
        <EmptyState title={emptyTitle} body={body} />
        {steps && steps.length > 0 ? (
          <ol className="mx-auto mb-6 flex w-full max-w-md flex-col gap-2.5">
            {steps.map((step, i) => (
              <li key={step} className="flex items-start gap-3 text-sm">
                <span className="g-num flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold">
                  {i + 1}
                </span>
                <span className="text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </Tile>
    </PortalPage>
  );
}

/** A small "nothing here yet" line for inside a Section. */
export function InlineEmpty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-muted/60 px-4 py-5 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Shows "Showing 20 of 54" under a capped list. */
export function MoreNote({ shown, total, noun }: { shown: number; total: number; noun: string }) {
  if (total <= shown) return null;
  return (
    <p className="px-5 py-3 text-xs text-muted-foreground">
      Showing the top {shown} of {total.toLocaleString()} {noun}.
    </p>
  );
}
