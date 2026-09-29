'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ShieldCheck } from 'lucide-react';
import { cn } from 'cn';
import { ConfirmDialog } from '@/components/admin/admin-ui';
import { useAdminControls, useAdminPreview } from '@/components/admin/preview/preview-context';
import { Button } from '@/components/portal/button';

/**
 * The admin's strip above a client screen: what you can do to this page's
 * data, in the client's own words. Hidden when admin controls are off, so
 * the screen underneath is exactly what the client sees.
 */
export function AdminPanel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const admin = useAdminControls();
  if (!admin) return null;

  return (
    <div className="mx-auto w-full max-w-6xl px-5 pt-5 md:px-8">
      <details
        open
        className="group rounded-2xl bg-[#fff8dc] ring-1 ring-[#e8c84a]/70"
        style={{ ['--admin-ink' as string]: '#3a2f00' }}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-2xl px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-[#3a2f00]/50 [&::-webkit-details-marker]:hidden">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#3a2f00] text-[#fdd34d]">
            <ShieldCheck className="size-3.5" aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-xs font-semibold tracking-[0.08em] text-[#7a6200] uppercase">Super admin · {title}</span>
            {description ? <span className="text-sm text-[#3a2f00]/80">{description}</span> : null}
          </span>
          <ChevronDown aria-hidden className="ml-auto size-4 shrink-0 text-[#3a2f00] transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="flex flex-col gap-1 border-t border-[#e8c84a]/60 px-4 py-2 text-[#3a2f00]">{children}</div>
      </details>
    </div>
  );
}

export interface ConfirmCopy {
  title: string;
  body: ReactNode;
  confirmLabel: string;
}

/**
 * One thing the admin can do: a sentence about it and a button. `run` does the
 * work and returns the sentence to show afterwards; throw to report a failure.
 * Give it `confirm` for anything that spends money or can't be undone.
 */
export function AdminAction({
  label,
  description,
  buttonLabel,
  pendingLabel = 'Working…',
  confirm,
  destructive = false,
  refreshAfter = true,
  disabled = false,
  run,
}: {
  label: string;
  description?: ReactNode;
  buttonLabel: string;
  pendingLabel?: string;
  confirm?: ConfirmCopy;
  destructive?: boolean;
  /** Reload the screen underneath once done. On by default: the point is to see the change. */
  refreshAfter?: boolean;
  disabled?: boolean;
  run: () => Promise<string>;
}) {
  const admin = useAdminControls();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  if (!admin) return null;

  async function execute() {
    const message = await run();
    admin!.notify('ok', message);
    if (refreshAfter) admin!.refresh();
  }

  async function onClick() {
    if (confirm) {
      setOpen(true);
      return;
    }
    setPending(true);
    try {
      await execute();
    } catch (err) {
      admin!.notify('error', err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-[#e8c84a]/40 py-2.5 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        {description ? <p className="text-xs leading-relaxed text-[#3a2f00]/75">{description}</p> : null}
      </div>
      <Button
        size="sm"
        variant="outline"
        className={cn('shrink-0 border-[#3a2f00]/30 bg-white/70 hover:bg-white', destructive && 'text-destructive')}
        disabled={disabled || pending}
        aria-busy={pending}
        onClick={() => void onClick()}
      >
        {pending ? pendingLabel : buttonLabel}
      </Button>
      {confirm ? (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={confirm.title}
          description={confirm.body}
          confirmLabel={confirm.confirmLabel}
          pendingLabel={pendingLabel}
          destructive={destructive}
          onConfirm={execute}
        />
      ) : null}
    </div>
  );
}

/** Wraps a tab so its content reloads when an admin action changes data. */
export function useTabVersion(): number {
  return useAdminPreview()?.version ?? 0;
}
