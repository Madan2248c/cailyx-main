'use client';

import Link from 'next/link';
import { ArrowRight, FileCode } from 'lucide-react';
import { StatusChip } from '@/components/portal/layout';
import { relativeDate } from '@/components/portal/tone';
import type { FixSpec } from '@/types/remediation';
import { STATUS_WORD } from '@/types/remediation';
import { SEVERITY_TONE, SEVERITY_WORD, STATUS_TONE, targetLabel } from './fix-meta';

/** One fix in the plan list. The whole row opens the fix's detail page. */
export function FixRow({ fix, href }: { fix: FixSpec; href: string }) {
  const verifiedLine =
    fix.status === 'VERIFIED' && fix.lastVerifiedAt ? `Verified ${relativeDate(fix.lastVerifiedAt)}` : null;
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-5 py-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-ring"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium">{fix.title}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="truncate">{targetLabel(fix.target)}</span>
          {fix.artifact ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-foreground">
              <FileCode className="size-3" aria-hidden /> Ready-made fix
            </span>
          ) : null}
          {verifiedLine ? <span className="text-success">{verifiedLine}</span> : null}
        </span>
      </span>
      <span className="hidden shrink-0 sm:inline-flex">
        {fix.status === 'OPEN' ? (
          <StatusChip tone={SEVERITY_TONE[fix.severity]}>{SEVERITY_WORD[fix.severity]}</StatusChip>
        ) : (
          <StatusChip tone={STATUS_TONE[fix.status]}>{STATUS_WORD[fix.status]}</StatusChip>
        )}
      </span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
