'use client';

import * as React from 'react';
import type { VariantProps } from 'class-variance-authority';
import { Button as MotionButton } from '@/components/animate-ui/primitives/buttons/button';
import { Button as UiButton, buttonVariants } from '@/components/ui/button';
import { cn } from 'cn';

type UiButtonProps = React.ComponentProps<typeof UiButton>;

/** Subtle, per the brand motion rules: a lift on hover, a press on tap. No bounce. */
const HOVER_SCALE = 1.02;
const TAP_SCALE = 0.97;

/**
 * The portal's button: the app's own variants and sizes (so it looks exactly
 * like every other button), rendered through Animate UI's motion button so
 * it lifts on hover and presses on tap. Accepts the same props as
 * `components/ui/button`, including Base UI's `render={<Link …/>}` pattern,
 * which becomes Animate UI's `asChild` so links move the same way.
 */
export function Button({ className, variant, size, render, nativeButton, children, ...props }: UiButtonProps) {
  const classes = cn(buttonVariants({ variant, size } as VariantProps<typeof buttonVariants>), className);

  if (render && React.isValidElement<{ className?: string; children?: React.ReactNode }>(render)) {
    void nativeButton;
    return (
      <MotionButton asChild hoverScale={HOVER_SCALE} tapScale={TAP_SCALE}>
        {React.cloneElement(render, {
          className: cn(classes, render.props.className),
          'data-slot': 'button',
          'data-motion': '',
          children: children ?? render.props.children,
        } as Record<string, unknown>)}
      </MotionButton>
    );
  }

  return (
    <MotionButton
      hoverScale={HOVER_SCALE}
      tapScale={TAP_SCALE}
      data-slot="button"
      data-motion=""
      className={classes}
      {...(props as React.ComponentProps<typeof MotionButton>)}
    >
      {children as never}
    </MotionButton>
  );
}

export { buttonVariants };
