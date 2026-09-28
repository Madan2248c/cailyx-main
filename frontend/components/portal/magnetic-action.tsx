'use client';

import { AnimateIcon } from '@/components/animate-ui/icons/icon';
import { Magnetic } from '@/components/animate-ui/primitives/effects/magnetic';

/**
 * The page's main action: it leans slightly toward the pointer (Animate UI
 * Magnetic) and plays its animated icon on hover. Off on touch screens and
 * for reduced motion (PortalMotion's MotionConfig).
 */
export function MagneticAction({ children }: { children: React.ReactNode }) {
  return (
    <Magnetic strength={0.22} range={90} onlyOnHover disableOnTouch>
      <AnimateIcon animateOnHover asChild>
        <span className="inline-flex">{children}</span>
      </AnimateIcon>
    </Magnetic>
  );
}
