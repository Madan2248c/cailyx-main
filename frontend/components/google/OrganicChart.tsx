'use client';

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

/** Minimal area chart — no chart library for two sparklines. */
export function AreaChart({
  values,
  labels,
  ariaLabel,
}: {
  values: number[];
  labels: string[];
  ariaLabel: string;
}) {
  if (values.length < 2) {
    return <p className="text-sm text-muted-foreground">Not enough days to draw yet.</p>;
  }
  const width = 560;
  const height = 120;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const coords = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (width - 8) + 4;
    const y = height - 8 - (v / max) * (height - 20);
    return { x, y };
  });
  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area = `4,${height - 4} ${line} ${(width - 4).toFixed(1)},${height - 4}`;
  const rangeLabel = `${ariaLabel}: ${min} to ${max}, ${labels[0] ?? ''} to ${labels[labels.length - 1] ?? ''}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={rangeLabel}>
      <desc>{`Values range from ${min} to ${max}.`}</desc>
      <polygon points={area} className="fill-primary opacity-10" />
      <polyline points={line} fill="none" strokeWidth="1.5" className="stroke-primary" />
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={i === coords.length - 1 ? 3 : 1.5} className="fill-primary">
          <title>{`${labels[i] ?? ''}: ${values[i]}`}</title>
        </circle>
      ))}
      <text x="4" y={height - 20} fontSize="11" className="fill-foreground">
        {labels[0] ?? ''}
      </text>
      <text x={width - 4} y={height - 20} fontSize="11" textAnchor="end" className="fill-foreground">
        {labels[labels.length - 1] ?? ''}
      </text>
      <text x="4" y="12" fontSize="11" className="fill-foreground">
        Max {max.toLocaleString()}
      </text>
    </svg>
  );
}

/** Current vs previous-period delta arrow. Set `invert` when lower is better (e.g. position). */
export function DeltaArrow({
  current,
  previous,
  invert,
}: {
  current: number | null;
  previous: number | null;
  invert?: boolean;
}) {
  if (current === null || previous === null || previous === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Minus aria-hidden="true" className="size-3.5" />
        <span aria-hidden="true">—</span>
        <span className="sr-only">No change</span>
      </span>
    );
  }
  const raw = current - previous;
  const improved = invert ? raw < 0 : raw > 0;
  const regressed = invert ? raw > 0 : raw < 0;
  const pct = Math.abs((raw / previous) * 100);
  const label = `${raw > 0 ? '+' : ''}${pct >= 100 ? Math.round(pct) : Math.round(pct * 10) / 10}%`;
  const direction = improved ? 'improved' : regressed ? 'falling' : 'no change';
  return (
    <span
      aria-label={`${label} ${direction} from ${previous} to ${current}`}
      className={
        improved
          ? 'inline-flex items-center gap-1 font-medium text-green-700 dark:text-green-400'
          : regressed
            ? 'inline-flex items-center gap-1 font-medium text-red-700 dark:text-red-400'
            : 'inline-flex items-center gap-1 text-muted-foreground'
      }
    >
      {improved ? (
        <ArrowUpRight aria-hidden="true" className="size-3.5" />
      ) : regressed ? (
        <ArrowDownRight aria-hidden="true" className="size-3.5" />
      ) : (
        <Minus aria-hidden="true" className="size-3.5" />
      )}{' '}
      {label}
      <span className="sr-only">({direction})</span>
    </span>
  );
}
