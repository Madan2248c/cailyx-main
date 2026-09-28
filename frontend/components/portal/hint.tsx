'use client';

import { CircleQuestionMark } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/animate-ui/components/animate/tooltip';

/**
 * A small "?" that explains a metric in plain words (Animate UI tooltip).
 * Founders shouldn't need to know what a citation rate or LCP is to read the
 * page, so every non-obvious number carries one of these.
 */
export function Hint({ children, label = 'What does this mean?' }: { children: React.ReactNode; label?: string }) {
  return (
    <Tooltip side="top" align="center">
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground/70 outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <CircleQuestionMark className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent className="g-tooltip">{children}</TooltipContent>
    </Tooltip>
  );
}
