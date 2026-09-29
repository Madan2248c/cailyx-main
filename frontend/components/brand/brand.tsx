import Image from 'next/image';
import { cn } from 'cn';

/**
 * Brand pieces shared by the client sidebar and the auth screens, so the
 * Cailyx lockup and the Rothenhall credit look the same everywhere.
 */

/** The Cailyx mark — three planes folding into a C. Vector trace of the approved logo. */
export function CailyxMark({ className }: { className?: string }) {
  return <Image src="/brand/cailyx-mark.svg" alt="" width={32} height={32} className={cn('size-8 shrink-0', className)} priority />;
}

/** Mark + "Cailyx" wordmark (the Rothenhall credit sits separately below). `size="lg"` for the centred auth header. */
export function CailyxLockup({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const lg = size === 'lg';
  return (
    <span className={cn('flex', lg ? 'flex-col items-center gap-3 text-center' : 'items-center gap-2')}>
      <CailyxMark className={lg ? 'size-12' : undefined} />
      <span className="leading-none">
        <span className={cn('font-heading font-bold tracking-[0.08em] uppercase', lg ? 'text-3xl' : 'text-xl')}>Cailyx</span>
      </span>
    </span>
  );
}

/** "Delivered by" + the Rothenhall Partners wordmark, linking to rothenhall.com. */
export function RothenhallCredit({ align = 'start' }: { align?: 'start' | 'center' }) {
  return (
    <a
      href="https://rothenhall.com"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Rothenhall Partners"
      className={cn(
        'flex flex-col gap-1 rounded px-1 py-1 opacity-80 transition-opacity duration-150 outline-none hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        align === 'center' && 'items-center',
      )}
    >
      <span className="text-[0.6rem] tracking-[0.14em] text-muted-foreground uppercase">Delivered by</span>
      <Image src="/brand/rothenhall-wordmark.png" alt="" width={160} height={28} className="h-auto w-[140px] dark:invert" />
    </a>
  );
}
