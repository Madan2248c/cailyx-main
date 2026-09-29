/**
 * Shared name-noise filter — used by both stance judging (to decide what
 * counts as `otherNamesSeen`) and verdict assembly (to decide what counts
 * toward `competitorStanding`). One definition of "noise" so the two never
 * drift: a name is noise when it's the subject's own brand or a well-known
 * non-competitor platform, regardless of whether it's a tracked competitor.
 *
 * @module aeo-audit/services/name-noise
 */

/**
 * Platforms/services an LLM commonly names in an AI-visibility answer that
 * are never a rival business.
 */
export const NON_COMPETITOR_PLATFORMS = new Set(
  [
    'chatgpt',
    'openai',
    'google',
    'perplexity',
    'gemini',
    'bing',
    'linkedin',
    'reddit',
    'g2',
    'capterra',
    'trustpilot',
    'youtube',
    'twitter',
    'x',
    'facebook',
    'instagram',
    'wikipedia',
  ].map((s) => s.toLowerCase()),
);

/**
 * ChatGPT answers carry source chips, so a brand often arrives with its own domain glued on
 * ("Woohoowoohoo.in", "GyFTRgyftr.com"). That splits one rival into two names. Strip the suffix when
 * the domain repeats the brand; leave every other name untouched.
 */
export function cleanBrandName(name: string): string {
  const trimmed = name.trim();
  const m = trimmed.match(/^(.+)\.(?:com|in|co\.in|app|io|net|org|ai|store|shop)$/i);
  if (!m) return trimmed;
  const glued = m[1];
  const alnum = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase();
  // Find the split where the brand repeats as the domain label: "Woohoo" + "woohoo".
  for (let k = 1; k < glued.length; k++) {
    if (alnum(glued.slice(0, k)) !== '' && alnum(glued.slice(0, k)) === alnum(glued.slice(k))) return glued.slice(0, k).trim();
  }
  return trimmed;
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/** True when `name` is the subject's own brand or a known non-competitor platform — never a real rival regardless of tracked/candidate status. */
export function isNoiseName(name: string, subjectName: string): boolean {
  const n = normalizeName(name);
  return n === normalizeName(subjectName) || NON_COMPETITOR_PLATFORMS.has(n);
}
