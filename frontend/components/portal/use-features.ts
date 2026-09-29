'use client';

import { useCallback } from 'react';
import { useLoad } from '@/components/admin/use-load';
import { getFeatures, type FeatureKey, type FeatureMap } from '@/lib/features-api';

/**
 * A client's feature switches. `features` is `null` until they load; treat
 * that as "not known yet" rather than "all on", so a switched-off page never
 * flashes into view. `enabled(key)` is true while unknown, so menus don't
 * blink empty; gate whole pages on `features !== null` instead.
 */
export function useFeatures(accessToken: string | null, clientId: string | null) {
  const load = useCallback(() => getFeatures(accessToken ?? '', clientId ?? ''), [accessToken, clientId]);
  const { data, error, reload } = useLoad<FeatureMap>(accessToken && clientId ? load : null, 'Failed to load features');

  return {
    features: data,
    error,
    reload,
    enabled: (key: FeatureKey) => data?.[key] ?? true,
  };
}
