import type { Day1Status } from '@/lib/settings-api';

/**
 * The Day-1 audit's steps, in run order, with a typical duration for each.
 * The durations only weight the progress bar and seed the time estimate; as
 * steps finish, the estimate is scaled by how fast this run has really been.
 */
export const DAY1_STEPS = [
  { key: 'discovery', label: 'Reading the website', typical: 90 },
  { key: 'technical-audit', label: 'Technical health audit', typical: 240 },
  { key: 'social-activity', label: 'Social channels', typical: 120 },
  { key: 'query-set', label: 'Building the AI questions', typical: 60 },
  { key: 'aeo-audit', label: 'Asking the AI engines', typical: 420 },
  { key: 'competitors', label: 'Finding competitors', typical: 90 },
  { key: 'gap-analysis', label: 'Gap analysis', typical: 45 },
  { key: 'remediation', label: 'Building the Fix Plan', typical: 15 },
  { key: 'reporting', label: 'Writing the report', typical: 30 },
  { key: 'notify', label: 'Emailing the client', typical: 5 },
] as const;

export type StepState = 'done' | 'skipped' | 'failed' | 'running' | 'waiting';

export interface StepProgress {
  key: string;
  label: string;
  state: StepState;
  /** Why it failed or was skipped, when known. */
  detail: string | null;
}

export interface Day1Progress {
  steps: StepProgress[];
  /** Steps that have settled successfully or been skipped. */
  finished: number;
  total: number;
  /** 0 to 100. Never 100 until the run is actually complete. */
  percent: number;
  elapsedSeconds: number | null;
  /** Rough seconds left, or null when it can't be said (finished, failed, or not started). */
  etaSeconds: number | null;
  /** Rough total length of a fresh run, for the "usually takes about" line. */
  typicalTotalSeconds: number;
}

const TOTAL = DAY1_STEPS.reduce((n, s) => n + s.typical, 0);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Turns the pipeline row into something a person can read: which step each is
 * in, how far along, how long it has run, and about how long is left.
 */
export function computeDay1Progress(day1: Pick<Day1Status, 'status' | 'currentStage' | 'stages' | 'startedAt' | 'finishedAt'>, nowMs: number = Date.now()): Day1Progress {
  const active = day1.status === 'RUNNING' || day1.status === 'QUEUED';

  const steps: StepProgress[] = DAY1_STEPS.map((s) => {
    const record = day1.stages[s.key];
    if (record?.status === 'completed') return { key: s.key, label: s.label, state: 'done', detail: null };
    if (record?.status === 'skipped') return { key: s.key, label: s.label, state: 'skipped', detail: record.skippedReason ?? null };
    if (record?.status === 'failed') return { key: s.key, label: s.label, state: 'failed', detail: record.error ?? null };
    if (active && day1.currentStage === s.key) return { key: s.key, label: s.label, state: 'running', detail: null };
    return { key: s.key, label: s.label, state: 'waiting', detail: null };
  });

  const settledWeight = DAY1_STEPS.reduce((n, s, i) => n + (steps[i].state === 'done' || steps[i].state === 'skipped' ? s.typical : 0), 0);
  const finished = steps.filter((s) => s.state === 'done' || s.state === 'skipped').length;
  const complete = day1.status === 'COMPLETE';
  const percent = complete ? 100 : Math.min(99, Math.round((settledWeight / TOTAL) * 100));

  const startedAt = day1.startedAt ? Date.parse(day1.startedAt) : null;
  const endAt = day1.finishedAt ? Date.parse(day1.finishedAt) : nowMs;
  const elapsedSeconds = startedAt !== null && Number.isFinite(startedAt) ? Math.max(0, Math.round((endAt - startedAt) / 1000)) : null;

  let etaSeconds: number | null = null;
  if (active && startedAt !== null) {
    // How long the finished steps took here compared with how long they usually take.
    const lastSettled = Math.max(
      0,
      ...Object.values(day1.stages).map((r) => (r?.finishedAt ? Date.parse(r.finishedAt) : 0)),
    );
    const workedSeconds = ((lastSettled > startedAt ? lastSettled : nowMs) - startedAt) / 1000;
    const speed = settledWeight > 0 && workedSeconds > 0 ? clamp(workedSeconds / settledWeight, 0.5, 3) : 1;

    // The step in progress is, on average, part-way through: count it at 60%.
    const remaining = DAY1_STEPS.reduce((n, s, i) => {
      if (steps[i].state === 'running') return n + s.typical * 0.6;
      if (steps[i].state === 'waiting') return n + s.typical;
      return n;
    }, 0);
    etaSeconds = Math.round(remaining * speed);
  }

  return { steps, finished, total: DAY1_STEPS.length, percent, elapsedSeconds, etaSeconds, typicalTotalSeconds: TOTAL };
}

/** "about 9 min", "under a minute", "1 h 5 min": deliberately rough, because the number is. */
export function formatDuration(seconds: number): string {
  if (seconds < 45) return 'under a minute';
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `about ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `about ${h} h` : `about ${h} h ${m} min`;
}
