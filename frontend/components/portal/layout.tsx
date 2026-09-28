'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { cn } from 'cn';
import { TONE_COLOR, TONE_SOFT, TONE_TEXT, type Tone } from './tone';

/** The page frame every portal tab sits in. */
export function PortalPage({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-5 py-7 md:px-8', className)}>{children}</div>;
}

export function PageHeader({
  eyebrow,
  title,
  meta,
  summary,
  actions,
}: {
  eyebrow?: string;
  title: string;
  meta?: React.ReactNode;
  /** One plain-language sentence: the answer before the numbers. */
  summary?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="g-rise flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow ? <p className="g-eyebrow">{eyebrow}</p> : null}
        <h1 className="text-3xl font-semibold leading-tight">{title}</h1>
        {meta ? <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">{meta}</div> : null}
        {summary ? <p className="max-w-2xl text-base text-foreground/85">{summary}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A dot + text separator for header meta rows. */
export function MetaDot() {
  return <span aria-hidden className="size-1 rounded-full bg-muted-foreground/50" />;
}

/**
 * A bento tile. Pass `href` to make the whole tile a link (it lifts on
 * hover), `ink` for the dark hero surface, and `index` for its place in the
 * entrance cascade.
 */
export function Tile({
  href,
  ink = false,
  index = 0,
  className,
  children,
  ariaLabel,
}: {
  href?: string;
  ink?: boolean;
  index?: number;
  className?: string;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  const classes = cn('g-tile g-rise p-5', ink && 'g-tile-ink', className);
  const style = { '--i': index } as React.CSSProperties;
  if (href) {
    return (
      <Link href={href} className={classes} style={style} aria-label={ariaLabel}>
        {children}
      </Link>
    );
  }
  return (
    <section className={classes} style={style} aria-label={ariaLabel}>
      {children}
    </section>
  );
}

export function TileHeader({
  icon: Icon,
  eyebrow,
  title,
  linkHint,
  right,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  eyebrow: string;
  title?: string;
  /** Shows the "go" arrow; use on tiles that are links. */
  linkHint?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-1.5">
          {Icon ? <Icon className="size-3.5 opacity-70" /> : null}
          <p className="g-eyebrow">{eyebrow}</p>
        </div>
        {title ? <h2 className="text-lg font-semibold leading-snug">{title}</h2> : null}
      </div>
      {right}
      {linkHint ? <ArrowUpRight className="g-row-arrow size-4 shrink-0 opacity-50" /> : null}
    </div>
  );
}

/** A small status chip: colored dot + word, readable without color. */
export function StatusChip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={cn('inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', TONE_TEXT[tone])}
      style={{ background: TONE_SOFT[tone] }}
    >
      <span className="size-1.5 rounded-full" style={{ background: TONE_COLOR[tone] }} />
      {children}
    </span>
  );
}

/**
 * A change vs the last comparable run. Arrow + signed number + optional
 * word; tone follows whether the move is good, not whether it went up.
 */
export function DeltaChip({
  change,
  higherIsBetter = true,
  unit = '',
  suffix,
  onInk = false,
}: {
  change: number | null;
  higherIsBetter?: boolean;
  unit?: string;
  suffix?: string;
  onInk?: boolean;
}) {
  if (change === null) return null;
  if (change === 0) {
    return (
      <span className={cn('inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', onInk ? 'bg-white/10 text-white/80' : 'bg-muted text-muted-foreground')}>
        ● no change{suffix ? ` ${suffix}` : ''}
      </span>
    );
  }
  const improved = higherIsBetter ? change > 0 : change < 0;
  const tone: Tone = improved ? 'good' : 'bad';
  return (
    <span
      className={cn('g-num inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', onInk ? 'bg-white/10' : TONE_TEXT[tone])}
      style={onInk ? { color: improved ? '#86d4a8' : '#f2a19a' } : { background: TONE_SOFT[tone] }}
    >
      {change > 0 ? '▲' : '▼'} {change > 0 ? '+' : '−'}
      {Math.abs(change)}
      {unit}
      {suffix ? <span className="font-normal opacity-80"> {suffix}</span> : null}
    </span>
  );
}
