'use client';

import { useEffect, useState } from 'react';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * Counts up to a measured value once, on mount. It animates the reveal of a
 * number that already exists, never progress toward one. Instant when the
 * user prefers reduced motion.
 */
export function CountUp({
  value,
  format = (n) => Math.round(n).toLocaleString(),
  durationMs = 900,
}: {
  value: number;
  format?: (n: number) => string;
  durationMs?: number;
}) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    let frame = 0;
    if (prefersReducedMotion() || value === 0) {
      frame = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(frame);
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutQuart, matching the soft brand curve's feel
      const eased = 1 - Math.pow(1 - t, 4);
      setShown(value * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);

  return (
    <span className="g-num" aria-label={format(value)}>
      <span aria-hidden>{format(shown)}</span>
    </span>
  );
}
