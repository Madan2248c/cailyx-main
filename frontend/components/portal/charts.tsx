'use client';

import { useId } from 'react';
import { TONE_COLOR, type Tone } from './tone';

/**
 * Hand-built SVG charts for the portal. No chart library: each is a few
 * elements, animates with the shared g-* classes, and exposes its value to
 * screen readers through role="img" + aria-label.
 */

// ─── Score ring ─────────────────────────────────────────────────────────────

export function ScoreRing({
  value,
  max = 100,
  tone,
  size = 120,
  stroke = 10,
  onInk = false,
  label,
  children,
  index = 0,
}: {
  value: number | null;
  max?: number;
  tone: Tone;
  size?: number;
  stroke?: number;
  /** Rendered on the dark hero tile. */
  onInk?: boolean;
  label: string;
  children?: React.ReactNode;
  index?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = value === null ? 0 : Math.max(0, Math.min(1, value / max));
  const to = c * (1 - ratio);
  const track = onInk ? 'rgba(255,255,255,0.12)' : 'var(--g-line, #ebebec)';
  const color = onInk && tone === 'neutral' ? '#f4f4f5' : TONE_COLOR[tone];

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        {value !== null ? (
          <circle
            className="g-draw"
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={to}
            style={{ '--g-dash-from': c, '--g-dash-to': to, '--i': index } as React.CSSProperties}
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

// ─── Sparkline ──────────────────────────────────────────────────────────────

export function Sparkline({
  points,
  width = 140,
  height = 40,
  tone = 'neutral',
  onInk = false,
  label,
}: {
  points: number[];
  width?: number;
  height?: number;
  tone?: Tone;
  onInk?: boolean;
  label: string;
}) {
  const id = useId().replace(/:/g, '');
  if (points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 4;
  const xy = points.map((p, i) => {
    const x = pad + (i / (points.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (p - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${xy[xy.length - 1][0].toFixed(1)},${height} L${xy[0][0].toFixed(1)},${height} Z`;
  const color = onInk && tone === 'neutral' ? '#f4f4f5' : TONE_COLOR[tone];
  const [lx, ly] = xy[xy.length - 1];
  const length = xy.reduce((sum, [x, y], i) => (i === 0 ? 0 : sum + Math.hypot(x - xy[i - 1][0], y - xy[i - 1][1])), 0);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="overflow-visible">
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${id})`} className="g-fade" />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="g-draw"
        strokeDasharray={length}
        strokeDashoffset={0}
        style={{ '--g-dash-from': length, '--g-dash-to': 0 } as React.CSSProperties}
      />
      <circle cx={lx} cy={ly} r={3} fill={color} className="g-fade" />
      <circle cx={lx} cy={ly} r={6} fill={color} opacity={0.15} className="g-fade" />
    </svg>
  );
}

// ─── Meter ──────────────────────────────────────────────────────────────────

export function Meter({
  value,
  max = 100,
  tone = 'neutral',
  height = 6,
  index = 0,
  onInk = false,
  label,
  color: colorOverride,
}: {
  value: number | null;
  max?: number;
  tone?: Tone;
  height?: number;
  index?: number;
  onInk?: boolean;
  label?: string;
  /** Explicit fill, e.g. a muted gray for "the other side" of a comparison. */
  color?: string;
}) {
  const ratio = value === null ? 0 : Math.max(0, Math.min(1, value / max));
  const color = colorOverride ?? (onInk && tone === 'neutral' ? '#f4f4f5' : TONE_COLOR[tone]);
  return (
    <div
      className="w-full overflow-hidden rounded-full"
      style={{ height, background: onInk ? 'rgba(255,255,255,0.12)' : 'var(--g-surface-strong, #f4f4f5)' }}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <div
        className="g-grow h-full rounded-full"
        style={{ width: `${ratio * 100}%`, background: color, '--i': index } as React.CSSProperties}
      />
    </div>
  );
}

// ─── Stacked bar ────────────────────────────────────────────────────────────

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function StackedBar({ segments, height = 12, label }: { segments: Segment[]; height?: number; label: string }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  if (total === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex w-full gap-[3px] overflow-hidden rounded-full" style={{ height }} role="img" aria-label={label}>
        {segments
          .filter((s) => s.value > 0)
          .map((s, i) => (
            <div
              key={s.key}
              className="g-grow h-full first:rounded-l-full last:rounded-r-full"
              style={{ width: `${(s.value / total) * 100}%`, background: s.color, '--i': i } as React.CSSProperties}
              title={`${s.label}: ${s.value}`}
            />
          ))}
      </div>
      <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.label}</span>
            <span className="g-num font-medium">{s.value}</span>
            <span className="g-num w-10 text-right text-xs text-muted-foreground">{Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Head-to-head bar ───────────────────────────────────────────────────────

/**
 * Wins against a rival grow right in the good tone, losses grow left in the
 * bad tone, from a shared center line. Scaled to the largest count on the
 * page so rows compare with each other.
 */
export function HeadToHead({
  ahead,
  behind,
  scale,
  index = 0,
  label,
}: {
  ahead: number;
  behind: number;
  scale: number;
  index?: number;
  label: string;
}) {
  const s = scale || 1;
  return (
    <div className="flex h-2.5 w-full items-center" role="img" aria-label={label}>
      <div className="flex h-full flex-1 justify-end overflow-hidden">
        <div
          className="g-grow h-full rounded-l-full"
          style={{ width: `${(behind / s) * 100}%`, background: 'var(--danger)', transformOrigin: 'right center', '--i': index } as React.CSSProperties}
        />
      </div>
      <div className="mx-[3px] h-4 w-px shrink-0 bg-[var(--g-line-strong,#d7d6d8)]" />
      <div className="flex h-full flex-1 overflow-hidden">
        <div
          className="g-grow h-full rounded-r-full"
          style={{ width: `${(ahead / s) * 100}%`, background: 'var(--success)', '--i': index } as React.CSSProperties}
        />
      </div>
    </div>
  );
}
