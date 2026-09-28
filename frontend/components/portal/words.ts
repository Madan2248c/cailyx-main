import type { Tone } from './tone';

/**
 * Plain-language words for the machine values the API returns, so no raw
 * key ("fail", "linkedin", "every-2-3-days") ever reaches a client's screen.
 */

const PLATFORM: Record<string, string> = {
  linkedin: 'LinkedIn',
  x: 'X',
  twitter: 'X',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  threads: 'Threads',
  pinterest: 'Pinterest',
  reddit: 'Reddit',
};

export function platformName(platform: string): string {
  return PLATFORM[platform.toLowerCase()] ?? humanize(platform);
}

/** "dormant-platform" / "robots_ai_access" → "Dormant platform". */
export function humanize(key: string): string {
  const words = key.replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Result of one check, as the client should read it. */
export const CHECK_RESULT: Record<string, { word: string; tone: Tone }> = {
  pass: { word: 'Passing', tone: 'good' },
  fail: { word: 'Needs fixing', tone: 'bad' },
  error: { word: "Couldn't check", tone: 'watch' },
  'not-run': { word: 'Not checked', tone: 'neutral' },
};

export function checkResult(status: string): { word: string; tone: Tone } {
  return CHECK_RESULT[status] ?? { word: humanize(status), tone: 'neutral' };
}

export const IMPACT_WORD: Record<string, string> = {
  high: 'High impact',
  medium: 'Medium impact',
  low: 'Low impact',
  HIGH: 'High impact',
  MEDIUM: 'Medium impact',
  LOW: 'Low impact',
};

export function impactWord(severity: string): string {
  return IMPACT_WORD[severity] ?? humanize(severity);
}
