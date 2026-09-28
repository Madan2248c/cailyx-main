'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowUpRight, Scale } from 'lucide-react';
import { Button } from '@/components/portal/button';
import { Textarea } from '@/components/ui/textarea';
import { decideFix } from '@/lib/remediation-api';
import type { FixSpec } from '@/types/remediation';
import { targetLabel } from './fix-meta';
import { CircleCheckBig } from '@/components/animate-ui/icons/circle-check-big';
import { MagneticAction } from '@/components/portal/magnetic-action';

/**
 * A fix that needs the client's say (design plan §3.3 "Approval card"): the
 * exact change, why it's their call, and approve / decline with an optional
 * note. Only the account owner (POC) decides; everyone else sees who can.
 */
export function ApprovalCard({
  fix,
  accessToken,
  clientId,
  canDecide,
  detailHref,
  onDecided,
}: {
  fix: FixSpec;
  accessToken: string;
  clientId: string;
  canDecide: boolean;
  detailHref?: string;
  onDecided: (updated: FixSpec) => void;
}) {
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<'APPROVED' | 'DECLINED' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'APPROVED' | 'DECLINED') {
    setPending(decision);
    setError(null);
    try {
      onDecided(await decideFix(accessToken, clientId, fix.id, decision, note));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your decision.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--warning-soft)' }}>
          <Scale className="size-4 text-warning" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-semibold">{fix.title}</p>
          <p className="text-xs text-muted-foreground">{targetLabel(fix.target)}</p>
          {fix.steps[0] ? <p className="text-sm text-foreground/85">{fix.steps[0]}</p> : null}
          {detailHref ? (
            <Link href={detailHref} className="inline-flex w-fit items-center gap-1 text-xs font-medium text-foreground underline-offset-4 hover:underline">
              See the details <ArrowUpRight className="size-3" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>

      {canDecide ? (
        <>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note for your Rothenhall lead (optional)"
            rows={2}
            className="text-sm"
            aria-label={`Note about: ${fix.title}`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <MagneticAction>
              <Button size="sm" onClick={() => decide('APPROVED')} disabled={pending !== null}>
                <CircleCheckBig className="size-4" aria-hidden />
                {pending === 'APPROVED' ? 'Saving…' : 'Approve'}
              </Button>
            </MagneticAction>
            <Button size="sm" variant="outline" onClick={() => decide('DECLINED')} disabled={pending !== null}>
              {pending === 'DECLINED' ? 'Saving…' : 'Decline'}
            </Button>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Your account owner can approve or decline this.</p>
      )}
    </div>
  );
}
