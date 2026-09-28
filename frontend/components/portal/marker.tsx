'use client';

import { HighlightText } from '@/components/animate-ui/primitives/texts/highlight';

/**
 * The one number that answers the page, underlined with a highlighter-pen
 * stroke that draws in once it's in view (Animate UI Highlight Text).
 */
export function Marker({ text, onInk = false }: { text: string; onInk?: boolean }) {
  const ink = onInk ? 'rgba(255,255,255,0.18)' : 'rgba(49,51,55,0.1)';
  return (
    <HighlightText
      text={text}
      inView
      inViewOnce
      delay={350}
      transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-sm px-0.5 font-semibold text-foreground"
      style={{ backgroundImage: `linear-gradient(transparent 58%, ${ink} 58%)` }}
    />
  );
}
