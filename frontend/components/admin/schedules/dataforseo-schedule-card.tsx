'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  collectDataforseoNow,
  DATAFORSEO_DATASETS,
  getDataforseoSchedule,
  setDataforseoSchedule,
  type DataforseoCollectResult,
  type DataforseoSchedule,
} from '@/lib/admin-api';
import type { ScheduleCadence } from '@/lib/schedules-api';
import type { Project } from '@/types/project';

const CADENCES: ScheduleCadence[] = ['WEEKLY', 'MONTHLY', 'MANUAL_ONLY'];

function cadenceVariant(cadence: ScheduleCadence | null): 'default' | 'secondary' | 'outline' {
  if (cadence === 'WEEKLY') return 'default';
  if (cadence === 'MONTHLY') return 'secondary';
  return 'outline';
}

function formatCollectResult(result: DataforseoCollectResult): string {
  const names = result.snapshots.map((s) => s.dataset).join(', ') || 'none';
  const skipped = result.skipped.length > 0 ? `. Skipped: ${result.skipped.join(', ')}` : '';
  return `Collected ${result.snapshots.length} snapshot(s) (${names}); cost $${result.totalCostUsd.toFixed(2)}${skipped}.`;
}

/**
 * DataForSEO pipeline row for one project — its own card so the existing
 * tech/social ProjectScheduleCard stays untouched. Self-loads its schedule
 * (null = never set) and wires cadence + datasets + spend opt-in to the
 * real PUT endpoint, plus a Collect-now button on the real POST endpoint.
 */
export function DataforseoScheduleCard({
  accessToken,
  clientId,
  project,
  onChanged,
}: {
  accessToken: string;
  clientId: string;
  project: Project;
  onChanged: () => void;
}) {
  const [schedule, setSchedule] = useState<DataforseoSchedule | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [cadence, setCadence] = useState<ScheduleCadence>('MANUAL_ONLY');
  const [datasets, setDatasets] = useState<string[]>([...DATAFORSEO_DATASETS]);
  const [spendOptIn, setSpendOptIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<'save' | 'collect' | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    getDataforseoSchedule(accessToken, clientId, project.id)
      .then((data) => {
        if (cancelled) return;
        setSchedule(data);
        if (data) {
          setCadence(data.cadence);
          if (data.datasets.length > 0) setDatasets(data.datasets);
          setSpendOptIn(data.spendOptIn);
        }
        setLoaded(true);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load DataForSEO schedule');
          setLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, project.id]);

  function toggleDataset(dataset: string) {
    setDatasets((prev) =>
      prev.includes(dataset) ? prev.filter((d) => d !== dataset) : [...prev, dataset],
    );
  }

  async function handleSave() {
    setPending('save');
    setError(null);
    setNotice(null);
    try {
      const updated = await setDataforseoSchedule(accessToken, clientId, project.id, {
        cadence,
        datasets,
        spendOptIn,
      });
      setSchedule(updated);
      setNotice(`Schedule saved: ${updated.cadence}${updated.active ? ' (active)' : ' (inactive)'}.`);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save DataForSEO schedule');
    } finally {
      setPending(null);
    }
  }

  async function handleCollect() {
    setPending('collect');
    setError(null);
    setNotice(null);
    try {
      const result = await collectDataforseoNow(accessToken, clientId, project.id, datasets);
      setNotice(formatCollectResult(result));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Collect failed');
    } finally {
      setPending(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">DataForSEO pipeline</CardTitle>
          {loaded ? (
            schedule ? (
              <>
                <Badge variant={cadenceVariant(schedule.cadence)}>{schedule.cadence}</Badge>
                <Badge variant={schedule.active ? 'default' : 'outline'}>
                  {schedule.active ? 'active' : 'inactive'}
                </Badge>
                {!schedule.spendOptIn ? (
                  <span className="text-xs text-muted-foreground">
                    Scheduled ticks skipped (no spend opt-in)
                  </span>
                ) : null}
              </>
            ) : (
              <Badge variant="outline">not scheduled yet</Badge>
            )
          ) : (
            <Badge variant="outline">loading…</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Cadence
          <select
            aria-label="DataForSEO cadence"
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            value={cadence}
            disabled={pending !== null}
            onChange={(e) => setCadence(e.target.value as ScheduleCadence)}
          >
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs text-muted-foreground">
            Datasets ({datasets.length}/{DATAFORSEO_DATASETS.length})
          </legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {DATAFORSEO_DATASETS.map((dataset) => (
              <label key={dataset} className="flex cursor-pointer items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  className="size-3.5 accent-current"
                  checked={datasets.includes(dataset)}
                  disabled={pending !== null}
                  onChange={() => toggleDataset(dataset)}
                />
                {dataset}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="size-3.5 accent-current"
            checked={spendOptIn}
            disabled={pending !== null}
            onChange={(e) => setSpendOptIn(e.target.checked)}
          />
          Spend opt-in (scheduled ticks collect nothing without this)
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={pending !== null} onClick={handleSave}>
            {pending === 'save' ? 'Saving…' : 'Save schedule'}
          </Button>
          <Button size="sm" variant="outline" disabled={pending !== null} onClick={handleCollect}>
            {pending === 'collect' ? 'Collecting…' : 'Collect now'}
          </Button>
        </div>

        {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
