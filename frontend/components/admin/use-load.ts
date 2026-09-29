'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Settled<T> {
  /** Which loader and reload count this outcome belongs to. */
  source: (() => Promise<T>) | null;
  tick: number;
  data: T | null;
  error: string | null;
}

/**
 * Loads data for an admin page. `load` must be stable (wrap it in
 * `useCallback`); pass `null` to wait, for example until a token exists.
 *
 * - `data` keeps the last good value while a reload runs, so a refresh never
 *   blanks the page. It is dropped if `load` itself changes (a different
 *   client, say), so one record never shows under another's name;
 * - `error` is the message of the latest failure, cleared by the next success;
 * - `reload()` runs `load` again and resolves once fresh data (or an error) has
 *   landed, so a write can `await reload()` before it announces success.
 *
 * State is only set from the promise callbacks, never synchronously inside
 * the effect, and a stale response is ignored.
 */
export function useLoad<T>(load: (() => Promise<T>) | null, fallbackError = 'Something went wrong') {
  const [tick, setTick] = useState(0);
  const [settled, setSettled] = useState<Settled<T>>({ source: null, tick: -1, data: null, error: null });
  const counter = useRef(0);
  const waiters = useRef<Array<{ tick: number; resolve: () => void }>>([]);

  useEffect(() => {
    if (!load) return;
    let cancelled = false;

    const release = () => {
      waiters.current = waiters.current.filter((w) => {
        if (w.tick > tick) return true;
        w.resolve();
        return false;
      });
    };

    load()
      .then((data) => {
        if (cancelled) return;
        setSettled({ source: load, tick, data, error: null });
        release();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const error = err instanceof Error ? err.message : fallbackError;
        setSettled((prev) => ({ source: load, tick, data: prev.source === load ? prev.data : null, error }));
        release();
      });

    return () => {
      cancelled = true;
    };
  }, [load, tick, fallbackError]);

  const reload = useCallback(
    () =>
      new Promise<void>((resolve) => {
        counter.current += 1;
        waiters.current.push({ tick: counter.current, resolve });
        setTick(counter.current);
      }),
    [],
  );

  const current = load !== null && settled.source === load;

  return {
    data: current ? settled.data : null,
    error: current ? settled.error : null,
    /** True until the first response, and again while a reload is in flight. */
    loading: load !== null && !(current && settled.tick === tick),
    reload,
  };
}
