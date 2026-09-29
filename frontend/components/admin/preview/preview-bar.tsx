'use client';

import Link from 'next/link';
import { Eye, LogOut, ShieldCheck } from 'lucide-react';
import { cn } from 'cn';
import { useAdminPreview } from '@/components/admin/preview/preview-context';

/**
 * The strip that never leaves the top of a preview: whose portal this is, that
 * the data is live, a switch between "as the client sees it" and "with admin
 * controls", and the way out. Yellow on purpose: nobody should mistake this
 * for the client's own portal.
 */
export function PreviewBar() {
  const preview = useAdminPreview();
  if (!preview) return null;
  const { client, clientId, controls, setControls } = preview;

  return (
    <div
      role="region"
      aria-label="Preview mode"
      className="sticky top-0 z-40 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[#d9a900] bg-[#fdd34d] px-4 py-2 text-[#2b2200] shadow-sm"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#2b2200] text-[#fdd34d]">
          <Eye className="size-3.5" aria-hidden />
        </span>
        <p className="min-w-0 text-sm">
          <span className="font-medium">Previewing</span>{' '}
          <span className="font-bold">{client?.name ?? '…'}</span>
          <span className="ml-2 hidden rounded-full bg-[#2b2200]/10 px-2 py-0.5 text-xs font-semibold sm:inline">Live data · changes apply to the client</span>
        </p>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={controls}
          onClick={() => setControls(!controls)}
          className="group flex items-center gap-2 rounded-full py-1 pr-1 pl-2.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[#2b2200]/60"
        >
          <ShieldCheck className="size-4" aria-hidden />
          <span>Admin controls</span>
          <span
            aria-hidden
            className={cn('relative h-5 w-9 rounded-full transition-colors duration-150 motion-reduce:transition-none', controls ? 'bg-[#2b2200]' : 'bg-[#2b2200]/25')}
          >
            <span
              className={cn(
                'absolute top-0.5 left-0.5 size-4 rounded-full bg-[#fdd34d] transition-transform duration-150 motion-reduce:transition-none',
                controls && 'translate-x-4',
              )}
            />
          </span>
        </button>
        <Link
          href={`/admin/clients/${clientId}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#2b2200] px-3 py-1.5 text-sm font-semibold text-[#fdd34d] outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#2b2200]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fdd34d]"
        >
          <LogOut className="size-4" aria-hidden />
          Exit preview
        </Link>
      </div>
    </div>
  );
}
