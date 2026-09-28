import type { Tone } from '@/components/portal/tone';
import type { FixClass, FixSpec, FixStatus } from '@/types/remediation';
import { LIVE_CHECKS } from '@/types/remediation';

export const STATUS_TONE: Record<FixStatus, Tone> = {
  OPEN: 'watch',
  AWAITING_DECISION: 'watch',
  IN_PROGRESS: 'neutral',
  APPLIED: 'neutral',
  VERIFIED: 'good',
  REGRESSED: 'bad',
  DISMISSED: 'neutral',
};

export const SEVERITY_WORD = { HIGH: 'High impact', MEDIUM: 'Medium impact', LOW: 'Low impact' } as const;
export const SEVERITY_TONE: Record<'HIGH' | 'MEDIUM' | 'LOW', Tone> = { HIGH: 'bad', MEDIUM: 'watch', LOW: 'neutral' };
export const EFFORT_WORD = { HIGH: 'bigger job', MEDIUM: 'a few hours', LOW: 'quick fix' } as const;

/** Tabs on the plan page, in the order someone works through them. */
export const PLAN_TABS = [
  { key: 'todo', label: 'To do', statuses: ['OPEN', 'REGRESSED'] as FixStatus[] },
  { key: 'progress', label: 'In progress', statuses: ['IN_PROGRESS', 'APPLIED'] as FixStatus[] },
  { key: 'verified', label: 'Verified', statuses: ['VERIFIED'] as FixStatus[] },
  { key: 'dismissed', label: 'Not needed', statuses: ['DISMISSED'] as FixStatus[] },
] as const;

const PLATFORM: Record<string, string> = {
  linkedin: 'LinkedIn',
  x: 'X',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
};

/** Where the fix applies, in plain words: a page path, "Whole site", a social channel or a buyer question. */
export function targetLabel(target: string): string {
  if (target.startsWith('social:')) return PLATFORM[target.slice(7)] ?? target.slice(7);
  // The question is already in the fix's title, so the location line just names the kind.
  if (target.startsWith('prompt:')) return 'Buyer question in AI answers';
  try {
    const url = new URL(target);
    return url.pathname === '/' || url.pathname === '' ? 'Whole site' : url.pathname;
  } catch {
    return target;
  }
}

/** Default owner by kind of work (decision 3 in the design doc: the client's developer for site changes). */
export function ownerLabel(fixClass: FixClass): string {
  if (fixClass === 'INVESTIGATE') return 'Rothenhall';
  if (fixClass === 'OFF_SITE') return 'Your team';
  if (fixClass === 'CONTENT') return 'Your content team';
  return 'Your developer';
}

export function canCheckNow(fix: Pick<FixSpec, 'acceptance' | 'status'>): boolean {
  return LIVE_CHECKS.includes(fix.acceptance.kind) && ['OPEN', 'IN_PROGRESS', 'APPLIED', 'REGRESSED'].includes(fix.status);
}

export function canMarkApplied(fix: Pick<FixSpec, 'status'>): boolean {
  return ['OPEN', 'IN_PROGRESS', 'REGRESSED'].includes(fix.status);
}

/** Evidence the client can read at a glance: short scalar facts, most useful first. */
export function evidenceFacts(evidence: Record<string, unknown>): Array<[string, string]> {
  const LABEL: Record<string, string> = {
    blockedSearch: 'Blocked search crawlers',
    blockedLiveFetch: 'Blocked assistant crawlers',
    blockedTraining: 'Blocked training crawlers',
    currentTitle: 'Current title',
    currentMeta: 'Current meta description',
    titleLength: 'Title length',
    metaDescLength: 'Meta description length',
    h1Count: 'Main headings on the page',
    currentCanonical: 'Current canonical',
    missingFields: 'Missing fields',
    staleDays: 'Days since the sitemap changed',
    sitemapUrl: 'Sitemap',
    cdnVendor: 'CDN / firewall',
    blockedBots: 'Bots refused',
    contentLossPercent: 'Content hidden without JavaScript (%)',
    lcpStatus: 'Loading speed',
    clsStatus: 'Layout stability',
    inpStatus: 'Responsiveness',
    performanceScore: 'Performance score',
    pageCount: 'Pages affected',
    detail: 'What we saw',
    prompt: 'Buyer question',
    losesTo: 'AI recommends instead',
  };
  const out: Array<[string, string]> = [];
  for (const [key, label] of Object.entries(LABEL)) {
    const v = evidence[key];
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      out.push([label, v.map(String).join(', ')]);
    } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out.push([label, String(v)]);
    }
  }
  return out;
}

export function evidencePages(evidence: Record<string, unknown>): string[] {
  const pages = evidence.pages;
  return Array.isArray(pages) ? pages.filter((p): p is string => typeof p === 'string') : [];
}
