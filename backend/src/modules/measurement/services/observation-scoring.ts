/**
 * Deterministic observation extraction from a raw surface answer: subject
 * mention (name or domain), citation to the subject's domain with its
 * 1-based position among the surface's citations. No I/O — pure, testable
 * in isolation. Ported from the old repo's `MeasurementService.extractObservation`.
 *
 * Competitor detection and share-of-voice are NOT ported: the old repo read
 * `Project.competitors`, a column that doesn't exist in this schema. No
 * competitor data source is wired into this repo yet — documented gap, see
 * `measurement.types.ts` `MeasurementSummary`.
 *
 * @module measurement/services/observation-scoring
 */

export interface ExtractedObservation {
  mentioned: boolean;
  cited: boolean;
  citedUrl: string | null;
  position: number | null;
  characterization: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Mention = full business name appears, OR the longest brand token (>= 4
 * chars, whole-word) appears — surfaces commonly use the bare brand even
 * when the project is recorded with a longer name — OR the subject's own
 * domain host appears in the answer text.
 */
export function extractObservation(
  answer: { text: string; citations: string[] },
  subject: { name: string; domain: string },
): ExtractedObservation {
  const textLower = answer.text.toLowerCase();
  const subjectHost = subject.domain
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]!
    .toLowerCase();
  const nameLower = (subject.name || '').toLowerCase();

  let nameMatch = false;
  if (nameLower.length > 2 && textLower.includes(nameLower)) {
    nameMatch = true;
  } else {
    const tokens = nameLower.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
    if (tokens.length > 0) {
      const longest = tokens.reduce((a, b) => (b.length > a.length ? b : a));
      nameMatch = new RegExp('(?:^|[^a-z0-9])' + longest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[^a-z0-9]|$)').test(textLower);
    }
  }

  const mentioned = nameMatch || (subjectHost.length > 3 && textLower.includes(subjectHost));

  let cited = false;
  let citedUrl: string | null = null;
  let position: number | null = null;
  answer.citations.forEach((url, idx) => {
    if (!cited && hostOf(url).endsWith(subjectHost)) {
      cited = true;
      citedUrl = url;
      position = idx + 1;
    }
  });

  return { mentioned, cited, citedUrl, position, characterization: mentioned ? 'present' : 'absent' };
}
