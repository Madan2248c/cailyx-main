/**
 * One vocabulary for "is this good?" across the portal. Every colored value
 * also carries a word (and charts carry arrows), so meaning never depends on
 * color alone.
 */

export type Tone = 'good' | 'watch' | 'bad' | 'neutral';

/** 0–100 scores: 80+ healthy, 50–79 needs work, below 50 at risk. */
export function scoreTone(score: number | null | undefined): Tone {
  if (score === null || score === undefined) return 'neutral';
  if (score >= 80) return 'good';
  if (score >= 50) return 'watch';
  return 'bad';
}

/** 0–1 AI-answer rates: 50%+ strong, 20–49% building, below 20% weak. */
export function rateTone(rate: number | null | undefined): Tone {
  if (rate === null || rate === undefined) return 'neutral';
  if (rate >= 0.5) return 'good';
  if (rate >= 0.2) return 'watch';
  return 'bad';
}

export const TONE_TEXT: Record<Tone, string> = {
  good: 'text-success',
  watch: 'text-warning',
  bad: 'text-danger',
  neutral: 'text-foreground',
};

/** Raw CSS colors, for SVG strokes and inline styles. */
export const TONE_COLOR: Record<Tone, string> = {
  good: 'var(--success)',
  watch: 'var(--warning)',
  bad: 'var(--danger)',
  neutral: 'var(--g-ink, currentColor)',
};

export const TONE_SOFT: Record<Tone, string> = {
  good: 'var(--success-soft)',
  watch: 'var(--warning-soft)',
  bad: 'var(--danger-soft)',
  neutral: 'var(--g-primary-soft, rgba(0,0,0,0.06))',
};

export const TONE_WORD: Record<Tone, string> = {
  good: 'Healthy',
  watch: 'Needs work',
  bad: 'At risk',
  neutral: 'Not measured',
};

export function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "3 days ago" style, falling back to the date after two weeks. */
export function relativeDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return formatDate(iso);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
