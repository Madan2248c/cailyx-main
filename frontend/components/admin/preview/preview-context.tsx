'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { useLoad } from '@/components/admin/use-load';
import { PortalRoutesProvider } from '@/components/portal/routes';
import { useFeatures } from '@/components/portal/use-features';
import { useAuth } from '@/contexts/auth-context';
import { setFeature, type FeatureKey, type FeatureMap } from '@/lib/features-api';
import { listClients } from '@/lib/team-api';
import type { ClientSummary } from '@/types/team';

export interface Flash {
  tone: 'ok' | 'error';
  text: string;
}

export interface AdminPreviewValue {
  clientId: string;
  client: ClientSummary | null;
  accessToken: string;
  /** Admin controls are drawn on top of the client's screens. Off shows exactly what the client sees. */
  controls: boolean;
  setControls: (on: boolean) => void;
  /** Feature switches for this client; `null` until loaded. */
  features: FeatureMap | null;
  setFeatureEnabled: (key: FeatureKey, enabled: boolean) => Promise<void>;
  /** Bumps whenever an admin action changed data, so the screen underneath reloads it. */
  version: number;
  refresh: () => void;
  notify: (tone: Flash['tone'], text: string) => void;
}

const PreviewContext = createContext<AdminPreviewValue | null>(null);

const CONTROLS_KEY = 'cailyx:preview:controls';

function readControls(): boolean {
  try {
    return localStorage.getItem(CONTROLS_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Inside the admin preview: everything about the client being viewed. `null` in the real client portal. */
export function useAdminPreview(): AdminPreviewValue | null {
  return useContext(PreviewContext);
}

/** The preview context, but only while admin controls are switched on. Tabs use this to draw their extra controls. */
export function useAdminControls(): AdminPreviewValue | null {
  const value = useContext(PreviewContext);
  return value && value.controls ? value : null;
}

export function AdminPreviewProvider({ clientId, children }: { clientId: string; children: ReactNode }) {
  const { accessToken } = useAuth();
  const [controls, setControlsState] = useState<boolean>(readControls);
  const [version, setVersion] = useState(0);
  const [flash, setFlash] = useState<Flash | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadClient = useCallback(async () => (await listClients(accessToken ?? '')).find((c) => c.id === clientId) ?? null, [accessToken, clientId]);
  const clientLoad = useLoad<ClientSummary | null>(accessToken ? loadClient : null);
  const featureState = useFeatures(accessToken, clientId);
  const [override, setOverride] = useState<FeatureMap | null>(null);
  const features = override ?? featureState.features;

  const notify = useCallback((tone: Flash['tone'], text: string) => {
    if (timer.current) clearTimeout(timer.current);
    setFlash({ tone, text });
    timer.current = setTimeout(() => setFlash(null), tone === 'error' ? 8000 : 4500);
  }, []);

  const setControls = useCallback((on: boolean) => {
    setControlsState(on);
    try {
      localStorage.setItem(CONTROLS_KEY, on ? '1' : '0');
    } catch {
      // Private mode: the toggle still works for this visit.
    }
  }, []);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const setFeatureEnabled = useCallback(
    async (key: FeatureKey, enabled: boolean) => {
      if (!accessToken) return;
      try {
        const next = await setFeature(accessToken, clientId, key, enabled);
        setOverride(next);
        notify('ok', `${enabled ? 'Switched on' : 'Switched off'} for the client.`);
      } catch (err) {
        notify('error', err instanceof Error ? err.message : 'Could not change that feature');
      }
    },
    [accessToken, clientId, notify],
  );

  const value = useMemo<AdminPreviewValue | null>(
    () =>
      accessToken
        ? { clientId, client: clientLoad.data, accessToken, controls, setControls, features, setFeatureEnabled, version, refresh, notify }
        : null,
    [accessToken, clientId, clientLoad.data, controls, setControls, features, setFeatureEnabled, version, refresh, notify],
  );

  return (
    <PreviewContext.Provider value={value}>
      <PortalRoutesProvider projectBase={(projectId) => `/admin/preview/${clientId}/projects/${projectId}`}>{children}</PortalRoutesProvider>
      {flash ? (
        <div
          role={flash.tone === 'error' ? 'alert' : 'status'}
          className="fixed right-4 bottom-4 z-50 flex max-w-sm items-start gap-2.5 rounded-xl bg-foreground px-4 py-3 text-sm text-background shadow-lg"
        >
          {flash.tone === 'ok' ? (
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-[#86d4a8]" aria-hidden />
          ) : (
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-[#f2a19a]" aria-hidden />
          )}
          <p className="min-w-0 flex-1 break-words">{flash.text}</p>
          <button
            type="button"
            onClick={() => setFlash(null)}
            aria-label="Dismiss"
            className="-my-0.5 -mr-1 rounded p-1 text-background/70 outline-none hover:text-background focus-visible:ring-2 focus-visible:ring-background/50"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}
    </PreviewContext.Provider>
  );
}
