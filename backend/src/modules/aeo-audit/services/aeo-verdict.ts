/**
 * Verdict assembly — pure function over stored Observation + AeoStance
 * rows. No composite score: ported faithfully from the old repo, which
 * computed none either (raw rate slices + plain-language headlines, one
 * 5-percentage-point threshold for "uneven vs consistent" engines — the
 * only numeric threshold anywhere in this path). Recomputable at any time
 * from the same rows, so callers never have to trust a stale cache.
 *
 * @module aeo-audit/services/aeo-verdict
 */

import {
  MAX_LOSING_PROMPTS,
  MAX_WINNING_PROMPTS,
  UNEVEN_ENGINE_GAP,
} from '../aeo-audit.constants.js';
import type { AeoVerdict, CompetitorStanding, JudgedSummary, SliceMetrics, Stance } from '../aeo-audit.types.js';
import { isNoiseName } from './name-noise.js';

export interface VerdictObservation {
  id: string;
  prompt: string;
  mentioned: boolean;
  cited: boolean;
  surface: string;
  bucketName: string | null;
  funnelStage: string;
  branding: string | null;
}

export interface VerdictStance {
  observationId: string;
  stance: Stance;
  recommendedOver: string[];
  losesTo: string[];
  /**
   * Every brand name the model's answer named, unfiltered (as stored on
   * `AeoStance`). Filtered inside `buildCompetitorStanding` by the same
   * noise rule stance judging applies to `otherNamesSeen` — the subject's
   * own brand and non-competitor platforms are never counted as a rival's
   * co-mention. A first live run surfaced this as a real bug: an earlier
   * version tallied co-mentions straight from this unfiltered list, so the
   * subject's own name and platforms like "G2" showed up as fake rivals.
   * See docs/chagelog.md.
   */
  brandsNamed: string[];
}

function metrics(rows: VerdictObservation[]): SliceMetrics {
  const n = rows.length;
  const mentioned = rows.filter((r) => r.mentioned).length;
  const cited = rows.filter((r) => r.cited).length;
  return {
    observations: n,
    mentionRate: n > 0 ? Number((mentioned / n).toFixed(4)) : 0,
    citationRate: n > 0 ? Number((cited / n).toFixed(4)) : 0,
  };
}

function groupBy<T, K extends string>(rows: T[], key: (row: T) => K | null): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k == null) continue;
    const list = map.get(k) ?? [];
    list.push(row);
    map.set(k, list);
  }
  return map;
}

export function buildVerdict(observations: VerdictObservation[], stances: VerdictStance[], subjectName: string): AeoVerdict {
  const unbranded = observations.filter((o) => o.branding === 'unbranded');
  const branded = observations.filter((o) => o.branding === 'branded');

  const byBucket = [...groupBy(observations, (o) => o.bucketName as string | null)].map(([bucket, rows]) => ({
    bucket,
    ...metrics(rows),
  }));
  const byFunnelStage = [...groupBy(observations, (o) => o.funnelStage)].map(([funnelStage, rows]) => ({
    funnelStage,
    ...metrics(rows),
  }));
  const bySurface = [...groupBy(observations, (o) => o.surface)].map(([surface, rows]) => ({
    surface,
    ...metrics(rows),
  }));

  const competitorStanding = buildCompetitorStanding(stances, subjectName);
  const judged = stances.length > 0 ? buildJudgedSummary(observations, stances) : null;

  const headlines = buildHeadlines({ observations, unbranded, bySurface: bySurfaceUnbranded(unbranded), judged, competitorStanding });

  return {
    counted: {
      overall: metrics(observations),
      unbranded: unbranded.length > 0 ? metrics(unbranded) : null,
      branded: branded.length > 0 ? metrics(branded) : null,
      byBucket,
      byFunnelStage,
      bySurface,
      competitorStanding,
    },
    judged,
    headlines,
  };
}

function bySurfaceUnbranded(unbranded: VerdictObservation[]): Array<{ surface: string } & SliceMetrics> {
  return [...groupBy(unbranded, (o) => o.surface)].map(([surface, rows]) => ({ surface, ...metrics(rows) }));
}

function buildCompetitorStanding(stances: VerdictStance[], subjectName: string): CompetitorStanding[] {
  const rows = new Map<string, CompetitorStanding>();
  const get = (name: string) => {
    const existing = rows.get(name);
    if (existing) return existing;
    const fresh: CompetitorStanding = { name, timesAhead: 0, timesBehind: 0, coMentions: 0 };
    rows.set(name, fresh);
    return fresh;
  };
  for (const s of stances) {
    const ranked = new Set([...s.recommendedOver, ...s.losesTo]);
    for (const name of s.recommendedOver) get(name).timesAhead += 1;
    for (const name of s.losesTo) get(name).timesBehind += 1;
    // brandsNamed is the raw, unfiltered list — noise-filtered here (never
    // the subject's own brand, never a non-competitor platform) before it
    // can count toward any rival's standing. A name already ranked above
    // is not double-counted as a co-mention too.
    for (const name of s.brandsNamed) {
      if (!ranked.has(name) && !isNoiseName(name, subjectName)) get(name).coMentions += 1;
    }
  }
  return [...rows.values()].sort((a, b) => b.timesBehind + b.timesAhead - (a.timesBehind + a.timesAhead));
}

function buildJudgedSummary(observations: VerdictObservation[], stances: VerdictStance[]): JudgedSummary {
  const promptById = new Map(observations.map((o) => [o.id, o.prompt]));
  const stanceCounts: Record<Stance, number> = {
    recommended_primary: 0,
    recommended_alternative: 0,
    mentioned_neutral: 0,
    mentioned_negative: 0,
    absent: 0,
  };
  for (const s of stances) stanceCounts[s.stance] += 1;

  const losingPrompts = stances
    .filter((s) => s.losesTo.length > 0)
    .sort((a, b) => b.losesTo.length - a.losesTo.length)
    .slice(0, MAX_LOSING_PROMPTS)
    .map((s) => ({ observationId: s.observationId, prompt: promptById.get(s.observationId) ?? '', losesTo: s.losesTo }));

  const winningPrompts = stances
    .filter((s) => s.stance === 'recommended_primary')
    .slice(0, MAX_WINNING_PROMPTS)
    .map((s) => ({ observationId: s.observationId, prompt: promptById.get(s.observationId) ?? '' }));

  return { stanceCounts, losingPrompts, winningPrompts };
}

function buildHeadlines(input: {
  observations: VerdictObservation[];
  unbranded: VerdictObservation[];
  bySurface: Array<{ surface: string } & SliceMetrics>;
  judged: JudgedSummary | null;
  competitorStanding: CompetitorStanding[];
}): string[] {
  const lines: string[] = [];
  const overall = metrics(input.observations);
  lines.push(`Mentioned in ${pct(overall.mentionRate)} of ${overall.observations} observations, cited in ${pct(overall.citationRate)}.`);

  if (input.unbranded.length > 0) {
    const u = metrics(input.unbranded);
    lines.push(`Unbranded visibility (the real test): mentioned ${pct(u.mentionRate)} of the time across ${u.observations} unbranded prompts.`);
  }

  if (input.bySurface.length >= 2) {
    const rates = input.bySurface.map((s) => s.mentionRate);
    const best = Math.max(...rates);
    const worst = Math.min(...rates);
    lines.push(
      best - worst >= UNEVEN_ENGINE_GAP
        ? `Visibility is uneven across engines: unbranded mention rate ranges from ${pct(worst)} to ${pct(best)}.`
        : `Visibility is consistent across engines: unbranded mention rate stays within ${pct(UNEVEN_ENGINE_GAP)} across all of them.`,
    );
  }

  if (input.judged) {
    const total = Object.values(input.judged.stanceCounts).reduce((a, b) => a + b, 0);
    if (total > 0) {
      const primaryRate = input.judged.stanceCounts.recommended_primary / total;
      lines.push(`${pct(primaryRate)} of judged answers recommended the subject as the top pick.`);
    }
  }

  const topRival = input.competitorStanding.find((c) => c.timesBehind > 0);
  if (topRival) {
    lines.push(`Most frequently loses out to ${topRival.name} (${topRival.timesBehind} time${topRival.timesBehind === 1 ? '' : 's'}).`);
  }

  return lines;
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
