'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { syncFixPlan } from '@/lib/remediation-api';

/**
 * Staff control: rebuild a project's Fix Plan from its latest audits now.
 * Plans also sync automatically after every audit and in the Day-1
 * pipeline; this is for "I just changed something, refresh it".
 */
export function SyncFixPlanButton({ accessToken, clientId, projectId }: { accessToken: string; clientId: string; projectId: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function sync() {
    setPending(true);
    setMessage(null);
    try {
      const out = await syncFixPlan(accessToken, clientId, projectId);
      const parts = [
        out.created ? `${out.created} new` : null,
        out.updated ? `${out.updated} updated` : null,
        out.verified ? `${out.verified} verified` : null,
        out.regressed ? `${out.regressed} came back` : null,
      ].filter(Boolean);
      setMessage({ tone: 'ok', text: parts.length ? `Fix Plan synced: ${parts.join(', ')}.` : 'Fix Plan is up to date.' });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Sync failed.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={sync} disabled={pending}>
        {pending ? 'Syncing…' : 'Sync fix plan'}
      </Button>
      {message ? (
        <span role="status" className={`text-xs ${message.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
          {message.text}
        </span>
      ) : null}
    </span>
  );
}
