'use client';

import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { CADENCE_OPTIONS, ConfirmDialog, ScheduleChip, Segmented } from '@/components/admin/admin-ui';
import { ScheduleRow, type ScheduleFeedback } from '@/components/admin/schedules/project-schedule-card';
import { Button } from '@/components/portal/button';
import { StatusChip } from '@/components/portal/layout';
import { plural } from '@/components/portal/tone';
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

function formatCollectResult(result: DataforseoCollectResult): string {
  const names = result.snapshots.map((s) => s.dataset).join(', ') || 'none';
  const skipped = result.skipped.length > 0 ? ` Skipped: ${result.skipped.join(', ')}.` : '';
  return `Collected ${plural(result.snapshots.length, 'snapshot')} (${names}) for $${result.totalCostUsd.toFixed(2)}.${skipped}`;
}

/**
 * DataForSEO pipeline row for one project. Self-loads its schedule (null =
 * never set) and wires cadence, datasets and spend opt-in to the real PUT
 * endpoint, plus a "Collect now" on the real POST endpoint. Collecting spends
 * real money, so it asks first.
 */
export function DataforseoScheduleCard({
  accessToken,
  clientId,
  project,
  onChanged,
  onFeedback,
}: {
  accessToken: string;
  clientId: string;
  project: Project;
  onChanged: () => void;
  onFeedback: (feedback: ScheduleFeedback) => void;
}) {
  const [schedule, setSchedule] = useState<DataforseoSchedule | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cadence, setCadence] = useState<ScheduleCadence>('MANUAL_ONLY');
  const [datasets, setDatasets] = useState<string[]>([...DATAFORSEO_DATASETS]);
  const [spendOptIn, setSpendOptIn] = useState(false);
  const [pending, setPending] = useState<'save' | null>(null);
  const [confirmCollect, setConfirmCollect] = useState(false);

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
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load the DataForSEO schedule');
        setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, clientId, project.id]);

  function toggleDataset(dataset: string) {
    setDatasets((prev) => (prev.includes(dataset) ? prev.filter((d) => d !== dataset) : [...prev, dataset]));
  }

  const nothingSelected = datasets.length === 0;
  const dirty =
    !schedule ||
    schedule.cadence !== cadence ||
    schedule.spendOptIn !== spendOptIn ||
    schedule.datasets.length !== datasets.length ||
    !schedule.datasets.every((d) => datasets.includes(d));

  async function handleSave() {
    setPending('save');
    try {
      const updated = await setDataforseoSchedule(accessToken, clientId, project.id, { cadence, datasets, spendOptIn });
      setSchedule(updated);
      onFeedback({ tone: 'ok', text: `${project.name}: DataForSEO schedule saved.` });
      onChanged();
    } catch (err) {
      onFeedback({ tone: 'error', text: `${project.name}: ${err instanceof Error ? err.message : 'Failed to save the DataForSEO schedule'}` });
    } finally {
      setPending(null);
    }
  }

  const waiting = schedule !== null && schedule.active && !schedule.spendOptIn;

  return (
    <>
      <ScheduleRow
        title="DataForSEO pipeline"
        description={
          loadError
            ? `Couldn't load this schedule: ${loadError}`
            : 'Rankings, backlinks and keyword data. Every dataset costs money, so scheduled runs need your opt-in.'
        }
        chip={
          loaded ? (
            <>
              <ScheduleChip schedule={schedule} />
              {waiting ? <StatusChip tone="watch">Waiting for spend opt-in</StatusChip> : null}
            </>
          ) : (
            <StatusChip tone="neutral">Loading…</StatusChip>
          )
        }
        footer={
          loaded && !loadError ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <Segmented
                  label={`DataForSEO cadence for ${project.name}`}
                  value={cadence}
                  options={CADENCE_OPTIONS}
                  disabled={pending !== null}
                  onChange={setCadence}
                />
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={spendOptIn}
                    disabled={pending !== null}
                    onChange={(e) => setSpendOptIn(e.target.checked)}
                  />
                  Allow scheduled spend
                </label>
                <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                  <Button size="sm" variant="outline" disabled={pending !== null || nothingSelected || !dirty} onClick={handleSave} aria-busy={pending === 'save'}>
                    {pending === 'save' ? 'Saving…' : 'Save schedule'}
                  </Button>
                  <Button size="sm" variant="outline" disabled={pending !== null || nothingSelected} onClick={() => setConfirmCollect(true)}>
                    Collect now
                  </Button>
                </div>
              </div>

              <details className="group rounded-lg bg-muted/50 open:pb-3">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                  <ChevronDown aria-hidden className="size-3.5 transition-transform group-open:rotate-180" />
                  Datasets
                  <span className="g-num font-normal text-muted-foreground">
                    {datasets.length} of {DATAFORSEO_DATASETS.length} selected
                  </span>
                </summary>
                <fieldset className="px-3">
                  <legend className="sr-only">DataForSEO datasets</legend>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-2 pt-1 sm:grid-cols-2 lg:grid-cols-3">
                    {DATAFORSEO_DATASETS.map((dataset) => (
                      <label key={dataset} className="flex cursor-pointer items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={datasets.includes(dataset)}
                          disabled={pending !== null}
                          onChange={() => toggleDataset(dataset)}
                        />
                        {dataset}
                      </label>
                    ))}
                  </div>
                  {nothingSelected ? <p className="pt-2 text-xs text-danger">Select at least one dataset to save or collect.</p> : null}
                </fieldset>
              </details>
            </div>
          ) : null
        }
      />

      <ConfirmDialog
        open={confirmCollect}
        onOpenChange={setConfirmCollect}
        title={`Collect ${plural(datasets.length, 'dataset')} for ${project.name}?`}
        description="This runs now and is billed by DataForSEO. When it finishes you will see what it cost and any dataset it skipped."
        confirmLabel="Collect now"
        pendingLabel="Collecting…"
        onConfirm={async () => {
          const result = await collectDataforseoNow(accessToken, clientId, project.id, datasets);
          onFeedback({ tone: 'ok', text: `${project.name}: ${formatCollectResult(result)}` });
          onChanged();
        }}
      />
    </>
  );
}
