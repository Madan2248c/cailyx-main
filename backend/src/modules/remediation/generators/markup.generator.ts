/**
 * Markup generators — Organization JSON-LD, canonical tags and llms.txt, built
 * only from confirmed company facts and crawled page data. Pure functions.
 * A field the facts don't supply is left out and reported, never invented.
 *
 * @module remediation/generators/markup.generator
 */

import type { CompanyFacts, SnapshotPage } from '../remediation.types.js';

/** The fields the technical audit's schema check requires on an Organization block. */
export const ORG_FIELDS = ['name', 'url', 'logo', 'sameAs', 'description'] as const;
export type OrgField = (typeof ORG_FIELDS)[number];

export interface OrganizationJsonLd {
  /** The `<script type="application/ld+json">` block, or null when even `name` is unknown. */
  snippet: string | null;
  /** Required fields the confirmed facts couldn't supply. */
  missing: OrgField[];
}

export function organizationJsonLd(facts: CompanyFacts): OrganizationJsonLd {
  const missing: OrgField[] = [];
  const doc: Record<string, unknown> = { '@context': 'https://schema.org', '@type': 'Organization' };

  if (facts.name) doc['name'] = facts.name;
  else missing.push('name');
  doc['url'] = facts.url;
  if (facts.logoUrl) doc['logo'] = facts.logoUrl;
  else missing.push('logo');
  if (facts.description) doc['description'] = facts.description;
  else missing.push('description');
  if (facts.sameAs.length > 0) doc['sameAs'] = facts.sameAs;
  else missing.push('sameAs');

  if (!facts.name) return { snippet: null, missing };
  const json = JSON.stringify(doc, null, 2);
  return { snippet: `<script type="application/ld+json">\n${json}\n</script>`, missing };
}

/** Pull the JSON text back out of a generated snippet — the guardrail parses it. */
export function jsonLdBody(snippet: string): string {
  return snippet.replace(/^<script[^>]*>/, '').replace(/<\/script>\s*$/, '').trim();
}

export function canonicalTag(pageUrl: string): string {
  return `<link rel="canonical" href="${escapeAttr(pageUrl)}" />`;
}

/** Pages listed in a generated llms.txt. */
const LLMS_TXT_MAX_PAGES = 25;

/**
 * An llms.txt (llmstxt.org format): H1 name, blockquote summary, then a
 * list of the site's healthiest crawled pages with their own titles.
 * Returns null when the name is unknown.
 */
export function llmsTxt(facts: CompanyFacts, pages: SnapshotPage[]): string | null {
  if (!facts.name) return null;
  const lines = [`# ${facts.name}`, ''];
  if (facts.description) lines.push(`> ${facts.description.replace(/\s+/g, ' ').trim()}`, '');
  if (facts.offerings.length > 0) {
    lines.push('## Offerings', '');
    for (const o of facts.offerings.slice(0, 15)) lines.push(`- ${o}`);
    lines.push('');
  }
  const good = pages
    .filter((p) => p.statusCode >= 200 && p.statusCode < 300 && p.signals.title)
    .sort((a, b) => b.score - a.score)
    .slice(0, LLMS_TXT_MAX_PAGES);
  lines.push('## Key pages', '');
  lines.push(`- [Home](${facts.url})`);
  for (const p of good) {
    if (sameUrl(p.url, facts.url)) continue;
    const desc = p.signals.metaDescription ? `: ${p.signals.metaDescription.replace(/\s+/g, ' ').trim()}` : '';
    lines.push(`- [${p.signals.title!.trim()}](${p.url})${desc}`);
  }
  return lines.join('\n') + '\n';
}

function sameUrl(a: string, b: string): boolean {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
