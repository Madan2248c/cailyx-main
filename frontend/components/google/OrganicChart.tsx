'use client';

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
  const coords = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (width - 8) + 4;
    const y = height - 8 - (v / max) * (height - 20);
    return { x, y };
  });
  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area = `4,${height - 4} ${line} ${(width - 4).toFixed(1)},${height - 4}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={ariaLabel}>
      <polygon points={area} className="fill-primary opacity-10" />
      <polyline points={line} fill="none" strokeWidth="1.5" className="stroke-primary" />
      {coords.length > 0 ? (
        <circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r="3" className="fill-primary" />
      ) : null}
      <text x="4" y={height - 20} fontSize="9" className="fill-muted-foreground">
        {labels[0] ?? ''}
      </text>
      <text x={width - 4} y={height - 20} fontSize="9" textAnchor="end" className="fill-muted-foreground">
        {labels[labels.length - 1] ?? ''}
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
    return <span className="text-muted-foreground">●</span>;
  }
  const raw = current - previous;
  const improved = invert ? raw < 0 : raw > 0;
  const regressed = invert ? raw > 0 : raw < 0;
  const pct = Math.abs((raw / previous) * 100);
  const label = `${raw > 0 ? '+' : ''}${pct >= 100 ? Math.round(pct) : Math.round(pct * 10) / 10}%`;
  return (
    <span className={improved ? 'font-medium text-green-600' : regressed ? 'font-medium text-red-600' : 'text-muted-foreground'}>
      {improved ? '▲' : regressed ? '▼' : '●'} {label}
    </span>
  );
}
