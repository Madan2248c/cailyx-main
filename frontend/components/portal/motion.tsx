'use client';

import { MotionConfig, useReducedMotion } from 'motion/react';
import { SlidingNumber } from '@/components/animate-ui/primitives/texts/sliding-number';
import { TooltipProvider } from '@/components/animate-ui/components/animate/tooltip';

/**
 * Motion defaults for every themed surface: Motion honors the OS
 * "reduce motion" setting (transforms off, fades kept), and one tooltip
 * provider so hints open instantly once one has been seen.
 */
export function PortalMotion({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider openDelay={200} closeDelay={150}>
        {children}
      </TooltipProvider>
    </MotionConfig>
  );
}

/**
 * A measured number that rolls into place (Animate UI Sliding Number) the
 * first time it scrolls into view. It animates the reveal of a value that
 * already exists, never progress toward one. Plain text for users who
 * prefer reduced motion, since the digit roller runs on its own spring.
 */
export function CountUp({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const reduced = useReducedMotion();
  const label = `${prefix}${value.toLocaleString()}${suffix}`;
  if (reduced) return <span className="g-num">{label}</span>;
  return (
    <span className="g-num inline-flex items-baseline" aria-label={label} role="text">
      <span aria-hidden className="inline-flex items-baseline">
        {prefix}
        <SlidingNumber number={value} fromNumber={0} inView inViewOnce thousandSeparator="," />
        {suffix}
      </span>
    </span>
  );
}
