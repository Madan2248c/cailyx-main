'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/portal/button';
import { syncFixPlan } from '@/lib/remediation-api';

export interface SyncResult {
  tone: 'ok' | 'error';
  text: string;
}

/**
 * Staff control: rebuild a project's Fix Plan from its latest audits now.
 * Plans also sync automatically after every audit and in the Day-1
 * pipeline; this is for "I just changed something, refresh it". The outcome
 * goes to `onResult`, so the page can show it as a banner instead of
 * squeezing a sentence into the row.
 */
export function SyncFixPlanButton({
  accessToken,
  clientId,
  projectId,
  projectName,
  onResult,
}: {
  accessToken: string;
  clientId: string;
  projectId: string;
  projectName: string;
  onResult: (result: SyncResult) => void;
}) {
  const [pending, setPending] = useState(false);

  async function sync() {
    setPending(true);
    try {
      const out = await syncFixPlan(accessToken, clientId, projectId);
      const parts = [
        out.created ? `${out.created} new` : null,
        out.updated ? `${out.updated} updated` : null,
        out.verified ? `${out.verified} verified` : null,
        out.regressed ? `${out.regressed} came back` : null,
      ].filter(Boolean);
      onResult({
        tone: 'ok',
        text: parts.length ? `${projectName}: Fix Plan synced (${parts.join(', ')}).` : `${projectName}: Fix Plan is already up to date.`,
      });
    } catch (err) {
      onResult({ tone: 'error', text: `${projectName}: ${err instanceof Error ? err.message : 'Sync failed.'}` });
    } finally {
      setPending(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={sync} disabled={pending} aria-busy={pending}>
      <RefreshCw aria-hidden className={pending ? 'size-3.5 animate-spin' : 'size-3.5'} />
      {pending ? 'Syncing…' : 'Sync Fix Plan'}
    </Button>
  );
}
