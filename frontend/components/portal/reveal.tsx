'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { Fade } from '@/components/animate-ui/primitives/effects/fade';
import { Slide } from '@/components/animate-ui/primitives/effects/slide';

/**
 * Entrance motion for the portal, built on Animate UI's Slide + Fade.
 * Soft spring, small offset, no bounce (brand motion rules). Content is
 * never gated: MotionConfig reducedMotion="user" (PortalMotion) drops the
 * movement and keeps a quick fade.
 */
const RISE = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0 },
};
const SPRING = { type: 'spring' as const, stiffness: 260, damping: 30, mass: 0.9 };

/** Fades and rises one element in place (no wrapper), once it scrolls into view. */
export function Reveal({ children, index = 0 }: { children: React.ReactElement; index?: number }) {
  return (
    <Slide asChild inView inViewOnce inViewMargin="0px 0px -40px 0px" variants={RISE} transition={SPRING} delay={Math.min(index, 10) * 55}>
      {children}
    </Slide>
  );
}

/**
 * Takes one container element and reveals each of its direct children in a
 * staggered cascade. Wrap a page's top-level container, or a grid of tiles,
 * without changing its markup.
 */
export function StaggerIn({ children }: { children: React.ReactElement<{ children?: React.ReactNode }> }) {
  const counter = { i: 0 };
  return staggerChildren(children, counter);
}

/** Grids cascade card by card instead of arriving as one block. */
function isGrid(el: React.ReactElement): boolean {
  const cls = (el.props as { className?: unknown }).className;
  return typeof el.type === 'string' && typeof cls === 'string' && /(^|\s)grid(\s|$)/.test(cls);
}

function staggerChildren(
  container: React.ReactElement<{ children?: React.ReactNode }>,
  counter: { i: number },
): React.ReactElement {
  const kids = React.Children.map(container.props.children, (child) => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return child;
    if (child.type === React.Fragment || isGrid(child)) return staggerChildren(child, counter);
    return <Reveal index={counter.i++}>{child}</Reveal>;
  });
  return React.cloneElement(container, undefined, kids);
}

/** Cross-fades the portal's main area on every route change. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <Fade key={pathname} className="flex flex-1 flex-col" transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </Fade>
  );
}
