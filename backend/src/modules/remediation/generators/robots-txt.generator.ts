/**
 * robots.txt generators — pure functions, no I/O.
 *
 * `unblockBots` is a minimal-change edit: the existing file is kept verbatim
 * and one new group is prepended that allows the named bots at `/`. Because
 * `selectGroup` picks the longest matching product token and, on a tie, the
 * first group in the file, a prepended group naming a bot exactly wins over
 * any existing group for it. So that this doesn't quietly widen access, the
 * new group carries over every non-root `Disallow`/`Allow` the bot was
 * already subject to (e.g. `/admin` stays blocked) — only the root block is
 * removed. The result is self-checked by the guardrail with the real matcher
 * (`robotsRootVerdicts`) before it is ever saved.
 *
 * @module remediation/generators/robots-txt.generator
 */

import { getBotByName } from '../../fetcher/fetcher.constants.js';
import { parseRobotsTxt, selectGroup, type RobotsGroup } from '../../fetcher/services/robots.service.js';

/** Patterns that block the whole site for a group. */
const ROOT_PATTERNS = new Set(['/', '/*', '*']);

export const GENERATED_MARKER = '# Added by Cailyx Fix Plan';

export interface UnblockResult {
  content: string | null;
  /** Bots whose name doesn't appear in their own User-Agent string — a robots.txt token can't target them. */
  untargetable: string[];
  error?: string;
}

/** A fresh robots.txt for a site that has none: allow everything, declare the sitemap if one is known. */
export function newRobotsTxt(sitemapUrl: string | null): string {
  const lines = [`${GENERATED_MARKER}`, 'User-agent: *', 'Allow: /'];
  if (sitemapUrl) lines.push('', `Sitemap: ${sitemapUrl}`);
  return lines.join('\n') + '\n';
}

/** The one line that declares a sitemap, for appending to an existing robots.txt. */
export function sitemapLine(sitemapUrl: string): string {
  return `Sitemap: ${sitemapUrl}`;
}

/**
 * Prepend a group allowing `botNames` at the root, preserving each bot's
 * existing non-root rules. Returns `content: null` with an `error` when the
 * stored file is known to be truncated — a partial file must never be
 * rewritten, since everything after the cut would be lost.
 */
export function unblockBots(existing: string, botNames: string[], opts: { truncated: boolean }): UnblockResult {
  if (opts.truncated) {
    return {
      content: null,
      untargetable: [],
      error: 'The stored robots.txt copy is truncated, so a full replacement file cannot be generated safely. Follow the steps to edit the live file.',
    };
  }

  const { groups } = parseRobotsTxt(existing);
  const untargetable: string[] = [];

  // Bots that shared the same previous group share one new group, so the
  // carried-over rules stay exactly what each bot had before.
  const byPrevious = new Map<RobotsGroup | null, string[]>();
  for (const name of botNames) {
    const bot = getBotByName(name);
    if (!bot || !bot.userAgent.toLowerCase().includes(name.toLowerCase())) {
      untargetable.push(name);
      continue;
    }
    const previous = selectGroup(groups, bot.userAgent);
    const list = byPrevious.get(previous) ?? [];
    list.push(name);
    byPrevious.set(previous, list);
  }

  if (byPrevious.size === 0) {
    return { content: null, untargetable, error: 'None of the blocked bots can be targeted by name in robots.txt.' };
  }

  const blocks: string[] = [];
  for (const [previous, names] of byPrevious) {
    const lines = [GENERATED_MARKER + ': allow AI search and assistant crawlers'];
    for (const n of names) lines.push(`User-agent: ${n}`);
    lines.push('Allow: /');
    for (const d of previous?.disallow ?? []) {
      if (d && !ROOT_PATTERNS.has(d)) lines.push(`Disallow: ${d}`);
    }
    for (const a of previous?.allow ?? []) {
      if (a && a !== '/') lines.push(`Allow: ${a}`);
    }
    blocks.push(lines.join('\n'));
  }

  const body = existing.replace(/\s+$/, '');
  return { content: `${blocks.join('\n\n')}\n\n${body}\n`, untargetable };
}
