import { useEffect, useState } from 'react';
import { getFixSummary } from '@/lib/remediation-api';
import type { FixSummary } from '@/types/remediation';

/**
 * The project's Fix Plan counts, for the sidebar badge and the dashboard
 * tile. `null` while loading or when the plan isn't available (e.g. the
 * module isn't migrated yet): callers render nothing rather than an error.
 */
export function useFixSummary(accessToken: string | null, clientId: string, projectId: string | undefined): FixSummary | null {
  const [summary, setSummary] = useState<FixSummary | null>(null);

  useEffect(() => {
    if (!accessToken || !clientId || !projectId) return;
    let cancelled = false;
    getFixSummary(accessToken, clientId, projectId)
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, projectId]);

  return summary;
}
