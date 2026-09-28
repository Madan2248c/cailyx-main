'use client';

import { cn } from 'cn';
import { PortalPage } from './layout';

/** Shimmer placeholder in the shape of the content that is loading. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('g-skeleton', className)} />;
}

/** Page-level loading: header + bento outline, so the layout doesn't jump. */
export function PortalLoading({ label = 'Loading' }: { label?: string }) {
  return (
    <PortalPage>
      <p className="sr-only" role="status">
        {label}…
      </p>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Skeleton className="h-56 md:col-span-2 md:row-span-2 md:h-auto" />
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-44 md:col-span-2" />
        <Skeleton className="h-44" />
      </div>
    </PortalPage>
  );
}

/**
 * Orbit motif: the brand's "AI answers" idea (your company as one body among
 * many in an answer's orbit). Used for empty states instead of a dash.
 */
export function OrbitArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 120" className={cn('text-foreground', className)} aria-hidden>
      <ellipse cx="80" cy="60" rx="64" ry="34" fill="none" stroke="currentColor" strokeOpacity="0.12" />
      <ellipse cx="80" cy="60" rx="44" ry="22" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeDasharray="3 4" />
      <circle cx="80" cy="60" r="11" fill="currentColor" fillOpacity="0.9" />
      <circle cx="80" cy="60" r="18" fill="currentColor" fillOpacity="0.06" />
      <circle cx="140" cy="52" r="4.5" fill="currentColor" fillOpacity="0.35" />
      <circle cx="30" cy="76" r="3.5" fill="currentColor" fillOpacity="0.25" />
      <circle cx="112" cy="80" r="3" fill="currentColor" fillOpacity="0.45" />
      <circle cx="52" cy="41" r="2.5" fill="currentColor" fillOpacity="0.3" />
    </svg>
  );
}

/** "Not measured yet" with what happens next, never a zero or a fail. */
export function EmptyState({
  title,
  body,
  compact = false,
}: {
  title: string;
  body: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 text-center', compact ? 'py-4' : 'py-10')}>
      <OrbitArt className={compact ? 'h-14 w-20' : 'h-24 w-32'} />
      <p className="text-base font-semibold">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

export function ErrorState({ message, title = "We couldn't load this page" }: { message: string; title?: string }) {
  return (
    <PortalPage>
      <div className="g-tile g-rise items-center gap-2 p-8 text-center">
        <p className="text-base font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">Refresh the page to try again. If it keeps happening, let your Rothenhall lead know.</p>
        <p className="text-xs text-muted-foreground/80">Details: {message}</p>
      </div>
    </PortalPage>
  );
}
