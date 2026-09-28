/**
 * Fix brief: a one-page, client-shareable overview of a project's fix plan
 * (why they're receiving it, where to start, what's inside, how to read a
 * fix, what happens after). It goes out alongside the Markdown fix pack to a
 * client's developers. Pure functions: `buildFixBrief` derives everything
 * from the pack, `renderFixBriefHtml` lays it out for A4 print.
 *
 * Copy rules: plain language, no em dashes, rates never ranks, and never a
 * promise of placement.
 *
 * @module remediation/services/fix-brief
 */

import { ROTHENHALL_WORDMARK_PNG } from '../assets/rothenhall-wordmark.js';
import type { FixPack } from './fix-pack.js';

type Fix = FixPack['fixes'][number];
type Level = 'HIGH' | 'MEDIUM' | 'LOW';

interface GroupInfo {
  label: string;
  /** One line under the label in "What's inside". */
  hint: string;
  /** Why to start here, for "Where to start". */
  start: string;
}

const GROUPS: Record<string, GroupInfo> = {
  performance: { label: 'Page speed', hint: 'Core Web Vitals', start: 'Slow pages lose visitors before they see anything.' },
  cdn: { label: 'AI crawler access', hint: 'CDN or firewall bot blocking', start: 'AI crawlers are turned away before they can read the site.' },
  robots: { label: 'Robots.txt', hint: 'Which crawlers may read the site', start: 'robots.txt decides which search and AI crawlers can read the site.' },
  sitemap: { label: 'Sitemap', hint: 'How crawlers find every page', start: 'The sitemap tells crawlers which pages exist and when they change.' },
  schema: { label: 'Structured data', hint: 'How the site describes the company to machines', start: 'Structured data tells search and AI tools who the company is.' },
  rendering: { label: 'Content without JavaScript', hint: 'What crawlers see before scripts run', start: 'Most AI crawlers do not run JavaScript, so hidden content is invisible to them.' },
  'agent-readiness': { label: 'AI agent readiness', hint: 'How easily AI tools can use the site', start: 'Small changes that make the site easier for AI agents to use.' },
  social: { label: 'Social channels', hint: 'Channels that have gone quiet', start: 'A quiet channel can look like a closed business.' },
  'aeo-content': { label: 'AI answer content', hint: 'Buyer questions where AI names a rival', start: 'Pages that answer the questions buyers ask AI assistants.' },
  'page.title': { label: 'Page titles', hint: 'Too long, too short or missing', start: 'Titles are the first line people read in search results.' },
  'page.meta': { label: 'Meta descriptions', hint: 'The summary shown in search results', start: 'Descriptions decide whether people click through from search.' },
  'page.h1': { label: 'Main headings (h1)', hint: 'Missing or doubled on a page', start: 'Each page needs one clear main heading that names its topic.' },
  'page.heading': { label: 'Heading order', hint: 'Levels skipped in the page outline', start: 'A clean heading outline helps crawlers understand each page.' },
  'page.canonical': { label: 'Canonical tags', hint: 'Which version of a page counts', start: 'Canonical tags stop duplicate pages competing with each other.' },
  'page.thin': { label: 'Thin pages', hint: 'Too little text to be useful', start: 'Pages with very little text rarely get shown or cited.' },
  'page.images': { label: 'Image alt text', hint: 'Images without a description', start: 'Alt text lets crawlers and screen readers understand images.' },
  'page.duplicate': { label: 'Duplicate pages', hint: 'Same content on more than one page', start: 'Duplicate pages split attention between copies.' },
  'page.noindex': { label: 'Hidden pages', hint: 'Pages told not to appear in search', start: 'Some pages are telling search engines to leave them out.' },
  'page.json': { label: 'Page structured data', hint: 'Markup missing on key pages', start: 'Page-level structured data helps search and AI tools read each page.' },
  'page.page': { label: 'Broken pages', hint: 'Pages that fail to load', start: 'Broken pages waste visits and crawler time.' },
  'page.url': { label: 'Page addresses', hint: 'URLs that are hard to read or share', start: 'Clean page addresses are easier to read, share and crawl.' },
};

function groupInfo(key: string): GroupInfo {
  const known = GROUPS[key];
  if (known) return known;
  const label = key.replace(/^page\./, '').replace(/[-.]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  return { label, hint: 'Other fixes', start: 'Worth fixing early.' };
}

const RANK: Record<Level, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const MAX_CATEGORIES = 7;

export interface FixBrief {
  project: { name: string; domain: string };
  total: number;
  toDo: number;
  verified: number;
  bySeverity: Record<Level, number>;
  categories: Array<{ label: string; hint: string; count: number }>;
  start: Array<{ title: string; note: string; tag: 'High' | 'Quick' | null }>;
  outcomes: string[];
  /** Name of the Markdown file this page accompanies. */
  packFileName: string;
}

/** Everything the page shows, derived from the pack (so it is correct for any project). */
export function buildFixBrief(pack: FixPack): FixBrief {
  const fixes = pack.fixes;
  const bySeverity: Record<Level, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of fixes) bySeverity[level(f.severity)] += 1;
  const verified = fixes.filter((f) => f.status === 'VERIFIED').length;

  // "What's inside": groups in plan order (the plan is sorted most important first).
  const counts = new Map<string, number>();
  for (const f of fixes) counts.set(f.groupKey, (counts.get(f.groupKey) ?? 0) + 1);
  const entries = [...counts.entries()];
  const shown = entries.slice(0, entries.length > MAX_CATEGORIES ? MAX_CATEGORIES - 1 : MAX_CATEGORIES);
  const rest = entries.slice(shown.length);
  const categories = shown.map(([key, count]) => ({ label: groupInfo(key).label, hint: groupInfo(key).hint, count }));
  if (rest.length > 0) {
    categories.push({
      label: 'Everything else',
      // "Heading order, thin pages, AI answer content": sentence case after the first, acronyms kept.
      hint: rest
        .map(([key], i) => {
          const label = groupInfo(key).label;
          return i > 0 && /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
        })
        .join(', '),
      count: rest.reduce((n, [, c]) => n + c, 0),
    });
  }

  return {
    project: { name: pack.project.name, domain: pack.project.domain },
    total: fixes.length,
    toDo: fixes.length - verified,
    verified,
    bySeverity,
    categories,
    start: whereToStart(fixes),
    outcomes: outcomesFor(new Set(fixes.map((f) => f.groupKey)), pack.project.domain),
    packFileName: packFileName(pack.project.domain),
  };
}

/** `fix-plan-faydo.in.md`: named for the site, not an internal id. */
export function packFileName(domain: string, ext = 'md'): string {
  return `fix-plan-${safeName(domain)}.${ext}`;
}

export function briefFileName(domain: string): string {
  return `fix-plan-${safeName(domain)}-overview.pdf`;
}

function safeName(domain: string): string {
  return domain.toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

function level(severity: string): Level {
  return severity === 'HIGH' || severity === 'MEDIUM' ? severity : 'LOW';
}

/**
 * Up to three places to begin: the most important fix, the quickest
 * worthwhile one, and a shared page template when many page fixes sit under
 * one path (fixing the template clears them together).
 */
function whereToStart(fixes: Fix[]): FixBrief['start'] {
  const open = fixes
    .map((f, i) => ({ f, n: i + 1 }))
    .filter(({ f }) => f.status !== 'VERIFIED');
  const ranked = [...open].sort(
    (a, b) => RANK[level(a.f.severity)] - RANK[level(b.f.severity)] || RANK[level(a.f.effort)] - RANK[level(b.f.effort)] || a.n - b.n,
  );

  const picks: FixBrief['start'] = [];
  const used = new Set<string>();
  const add = (item: { f: Fix; n: number }) => {
    used.add(item.f.groupKey);
    picks.push({
      title: groupInfo(item.f.groupKey).label,
      note: `${specificNote(item.f) ?? groupInfo(item.f.groupKey).start} See fix ${item.n}.`,
      tag: level(item.f.severity) === 'HIGH' ? 'High' : level(item.f.effort) === 'LOW' ? 'Quick' : null,
    });
  };

  if (ranked[0]) add(ranked[0]);
  const quick = ranked.find(({ f }) => !used.has(f.groupKey) && level(f.effort) === 'LOW' && level(f.severity) !== 'LOW');
  if (quick) add(quick);

  const template = sharedTemplate(open.map(({ f }) => f));
  if (template && picks.length < 3) {
    picks.push({
      title: `The ${template.prefix} page template`,
      note: `${template.count} of the page fixes are on ${template.prefix} pages, so one template change can clear many at once.`,
      tag: null,
    });
  }

  for (const item of ranked) {
    if (picks.length >= 3) break;
    if (!used.has(item.f.groupKey)) add(item);
  }
  return picks;
}

/** A concrete detail from the evidence, when the fix carries one. */
function specificNote(f: Fix): string | null {
  const e = (f.evidence && typeof f.evidence === 'object' ? f.evidence : {}) as Record<string, unknown>;
  if (f.groupKey === 'performance' && typeof e['lcp'] === 'number' && e['lcp'] > 0) {
    const seconds = Math.round((e['lcp'] as number) / 100) / 10;
    return `The homepage takes ${seconds} seconds to show its main content.`;
  }
  if (f.groupKey === 'cdn') {
    const bots = Array.isArray(e['blockedBots']) ? (e['blockedBots'] as unknown[]).filter((b): b is string => typeof b === 'string') : [];
    const vendor = typeof e['cdnVendor'] === 'string' ? e['cdnVendor'] : 'The CDN';
    if (bots.length > 0) {
      const named = bots.length > 2 ? `${bots.slice(0, 2).join(', ')} and others` : bots.join(' and ');
      return `${vendor} is refusing ${named}. Usually one setting change.`;
    }
  }
  if (f.groupKey === 'rendering' && typeof e['contentLossPercent'] === 'number') {
    return `${Math.round(e['contentLossPercent'] as number)}% of the homepage text only appears after JavaScript runs.`;
  }
  return null;
}

/** The first path segment shared by many page-level fixes, e.g. "/brand/". */
function sharedTemplate(fixes: Fix[]): { prefix: string; count: number } | null {
  const pageFixes = fixes.filter((f) => f.groupKey.startsWith('page.'));
  const byPrefix = new Map<string, number>();
  for (const f of pageFixes) {
    const segment = pathSegment(f.target);
    if (segment) byPrefix.set(segment, (byPrefix.get(segment) ?? 0) + 1);
  }
  const [best] = [...byPrefix.entries()].sort((a, b) => b[1] - a[1]);
  if (!best) return null;
  const [prefix, count] = best;
  return count >= 5 && count >= pageFixes.length * 0.4 ? { prefix, count } : null;
}

function pathSegment(target: string): string | null {
  try {
    const parts = new URL(target).pathname.split('/').filter(Boolean);
    return parts.length >= 2 ? `/${parts[0]}/` : null;
  } catch {
    return null;
  }
}

/** Three plain outcomes, chosen from what this plan actually touches. No promises of placement. */
function outcomesFor(groups: Set<string>, domain: string): string[] {
  const has = (...keys: string[]) => keys.some((k) => groups.has(k));
  const out: string[] = [];
  if (has('performance')) out.push('A faster site that holds visitors instead of losing them while it loads.');
  if (has('cdn', 'robots', 'rendering', 'agent-readiness')) out.push(`AI assistants can read ${domain}, which they need before they can mention or cite it.`);
  if (has('page.title', 'page.meta', 'page.h1')) out.push(`Clearer titles and descriptions wherever ${domain} appears in search results.`);
  if (has('schema', 'page.json')) out.push('Search and AI tools get a clear, consistent description of the company.');
  if (has('aeo-content')) out.push('Pages that answer the questions buyers put to AI assistants.');
  if (has('page.thin', 'page.duplicate', 'page.canonical', 'page.heading')) out.push('Pages that are easier to understand and index.');
  const fallback = [
    'Every fix is re-checked on the live site, so you know it worked.',
    'Progress you can see in the Fix Plan and in each monthly report.',
    `A cleaner, easier-to-read ${domain} for people and machines.`,
  ];
  for (const line of fallback) if (out.length < 3) out.push(line);
  return out.slice(0, 3);
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Percent widths for the severity bar; any non-zero share stays visible. */
function barWidths(b: Record<Level, number>, total: number): Record<Level, number> {
  if (total === 0) return { HIGH: 0, MEDIUM: 0, LOW: 0 };
  const raw = { HIGH: (b.HIGH / total) * 100, MEDIUM: (b.MEDIUM / total) * 100, LOW: (b.LOW / total) * 100 };
  const min = 2.5;
  const bumped = { HIGH: b.HIGH ? Math.max(raw.HIGH, min) : 0, MEDIUM: b.MEDIUM ? Math.max(raw.MEDIUM, min) : 0, LOW: b.LOW ? Math.max(raw.LOW, min) : 0 };
  const sum = bumped.HIGH + bumped.MEDIUM + bumped.LOW;
  return { HIGH: (bumped.HIGH / sum) * 100, MEDIUM: (bumped.MEDIUM / sum) * 100, LOW: (bumped.LOW / sum) * 100 };
}

/** The A4 page, in the Cailyx portal's look (Montserrat, graphite ink, status tints). */
export function renderFixBriefHtml(brief: FixBrief): string {
  const { project, bySeverity } = brief;
  const name = esc(project.name);
  const domain = esc(project.domain);
  const widths = barWidths(bySeverity, brief.total);
  const maxCount = Math.max(1, ...brief.categories.map((c) => c.count));

  const headline =
    brief.verified > 0
      ? `${plural(brief.verified, 'fix is', 'fixes are')} already verified on the live site. The rest are listed most important first.`
      : `Every issue our audit found on ${domain}, turned into a concrete change, most important first.`;

  const categories = brief.categories
    .map(
      (c) => `<tr><td>${esc(c.label)} <span class="sub">${esc(c.hint)}</span></td><td class="n">${c.count}</td><td class="meter"><div class="m"><span style="width:${Math.max(3, Math.round((c.count / maxCount) * 100))}%"></span></div></td></tr>`,
    )
    .join('\n      ');

  const start = brief.start.length
    ? brief.start
        .map(
          (s, i) =>
            `<li><span class="num">${i + 1}</span><p><b>${esc(s.title)}</b>${s.tag ? `<span class="chip ${s.tag === 'High' ? 'bad' : 'watch'}">${s.tag}</span>` : ''}<br><span class="muted">${esc(s.note)}</span></p></li>`,
        )
        .join('\n      ')
    : '<li><span class="num">✓</span><p><b>Nothing left to do</b><br><span class="muted">Every fix in this plan is verified on the live site.</span></p></li>';

  const outcomes = brief.outcomes.map((o) => `<div class="outcome"><span class="tick">✓</span><span>${esc(o)}</span></div>`).join('\n    ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Fix Plan for ${domain}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${STYLES}</style>
</head>
<body>

<header>
  <img class="logo" alt="Rothenhall Partners" src="${ROTHENHALL_WORDMARK_PNG}">
  <div class="eyebrow" style="margin-top:3mm">Cailyx Fix Plan</div>
  <h1>Fix Plan for ${domain}</h1>
  <p class="lede">A one-page guide for the ${name} development team: why this plan exists, where to start, and what happens once the fixes are live.</p>
</header>

<section class="tile ink">
  <div>
    <div class="eyebrow">In this plan</div>
    <div class="big">${brief.total} <small>${brief.total === 1 ? 'fix' : 'fixes'}</small></div>
  </div>
  <div>
    <p class="headline">${headline}</p>
    <div class="bar" aria-hidden="true">
      <span style="width:${widths.HIGH}%;background:#f2a19a"></span>
      <span style="width:${widths.MEDIUM}%;background:#e8c48f"></span>
      <span style="width:${widths.LOW}%;background:rgba(255,255,255,.55)"></span>
    </div>
    <div class="legend">
      <span><i style="background:#f2a19a"></i>${bySeverity.HIGH} high impact</span>
      <span><i style="background:#e8c48f"></i>${bySeverity.MEDIUM} medium impact</span>
      <span><i style="background:rgba(255,255,255,.55)"></i>${bySeverity.LOW} low impact</span>
    </div>
  </div>
</section>

<div class="grid">
  <section class="tile">
    <h2>Why you're receiving this</h2>
    <p class="muted">${name} works with Rothenhall to improve how it shows up in Google and in AI answers from assistants such as ChatGPT, Perplexity and Gemini. We audited ${domain} for speed, crawler access, page structure and AI readiness. This plan turns each finding into a specific change your team can make, with a clear test for when it's done.</p>
  </section>

  <section class="tile">
    <h2>Where to start</h2>
    <ol class="start">
      ${start}
    </ol>
  </section>
</div>

<div class="grid">
  <section class="tile">
    <h2>What's inside</h2>
    <table>
      ${categories}
    </table>
  </section>

  <section class="tile">
    <h2>How to read each fix</h2>
    <dl class="read">
      <dt>Where</dt><dd>The exact page the fix applies to.</dd>
      <dt>Severity / effort</dt><dd>How much it matters, and roughly how much work it is.</dd>
      <dt>Done when</dt><dd>The test we run to confirm it. No judgement calls: it either passes or it doesn't.</dd>
      <dt>Steps</dt><dd>What to change, in order.</dd>
      <dt>Ready-made fix</dt><dd>Where we could build it for you, the code is included to paste in.</dd>
    </dl>
  </section>
</div>

<section class="tile">
  <h2>What happens when a fix is done</h2>
  <div class="flow">
    <div class="step"><div class="k">You</div><p>Make the change and deploy<span>Tell your Rothenhall lead, or mark it in the Cailyx portal.</span></p></div>
    <div class="arrow">→</div>
    <div class="step"><div class="k">We</div><p>Check the live site<span>Each fix is re-tested against its "done when" line.</span></p></div>
    <div class="arrow">→</div>
    <div class="step"><div class="k">Result</div><p>Marked verified<span>Progress shows in your Fix Plan and in the next monthly report.</span></p></div>
  </div>
  <div class="outcomes">
    ${outcomes}
  </div>
</section>

<footer>
  <span>The full list, with steps for every fix, is in <b>${esc(brief.packFileName)}</b>, shared with this page.</span>
  <span>Questions about a fix? Your Rothenhall lead can help.</span>
</footer>

</body>
</html>`;
}

const STYLES = `
  @page { size: A4; margin: 0; }
  :root {
    --ink: #313337; --ink-soft: #5b5e62; --ink-muted: #8b8d90;
    --line: #ebebec; --surface: #fefefe; --canvas: #f9f9f9;
    --good: #2f7a52; --watch: #9a5b0b; --bad: #b3261e;
    --good-soft: #eaf3ee; --watch-soft: #f6efe4; --bad-soft: #f8e9e8;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: 210mm; height: 296mm; overflow: hidden;
    background: var(--canvas); color: var(--ink);
    font-family: Montserrat, system-ui, sans-serif; font-size: 8.4pt; line-height: 1.45;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
    padding: 9mm 13mm 7mm;
    display: flex; flex-direction: column; gap: 2.8mm;
  }
  .eyebrow { font-size: 7pt; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-soft); }
  h1 { font-size: 18pt; font-weight: 700; letter-spacing: -.02em; line-height: 1.15; margin: 1mm 0 .6mm; }
  h2 { font-size: 7pt; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-soft); margin: 0 0 2.2mm; }
  p { margin: 0; }
  .muted { color: var(--ink-soft); }
  .logo { display: block; height: 8mm; width: auto; }
  .lede { font-size: 9.4pt; color: var(--ink-soft); max-width: 150mm; }

  .tile { background: var(--surface); border-radius: 3.6mm; box-shadow: 0 0 0 .3mm var(--line), 0 .4mm 1.6mm rgba(49,51,55,.05); padding: 3.4mm 4.2mm; }
  .ink {
    color: #f4f4f5;
    background: radial-gradient(120% 90% at 100% 0%, rgba(255,255,255,.09), transparent 55%), linear-gradient(160deg, #3a3c41 0%, #26282b 100%);
    box-shadow: 0 1.2mm 4mm rgba(33,35,38,.18);
    display: grid; grid-template-columns: 38mm 1fr; gap: 6mm; align-items: center;
  }
  .ink .eyebrow { color: rgba(244,244,245,.66); }
  .headline { font-size: 10pt; font-weight: 600; color: #fff; }
  .big { font-size: 30pt; font-weight: 700; letter-spacing: -.03em; line-height: 1; }
  .big small { font-size: 11pt; font-weight: 500; color: rgba(244,244,245,.7); letter-spacing: 0; }
  .bar { display: flex; height: 2.4mm; border-radius: 2mm; overflow: hidden; background: rgba(255,255,255,.12); margin: 2.6mm 0 2mm; }
  .bar span { display: block; height: 100%; }
  .legend { display: flex; gap: 4.5mm; font-size: 7.8pt; color: rgba(244,244,245,.8); }
  .legend i { display: inline-block; width: 2mm; height: 2mm; border-radius: 50%; margin-right: 1.3mm; vertical-align: .1mm; }

  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2.8mm; align-items: stretch; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: .8mm 0; border-top: .25mm solid var(--line); vertical-align: middle; }
  tr:first-child td { border-top: 0; padding-top: 0; }
  td.n { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; width: 9mm; }
  td.meter { width: 22mm; padding-left: 3mm; }
  .m { height: 1.3mm; border-radius: 1mm; background: #f1f1f2; overflow: hidden; }
  .m span { display: block; height: 100%; background: var(--ink); border-radius: 1mm; }
  .sub { display: block; font-size: 7pt; line-height: 1.3; color: var(--ink-muted); }

  ol.start { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1.8mm; }
  ol.start li { display: grid; grid-template-columns: 6mm 1fr; gap: 2.4mm; }
  .num { width: 5.2mm; height: 5.2mm; border-radius: 50%; border: .3mm solid var(--line); display: flex; align-items: center; justify-content: center; font-size: 7.6pt; font-weight: 700; background: #fff; }
  b { font-weight: 600; color: var(--ink); }
  .chip { display: inline-block; font-size: 6.8pt; font-weight: 600; border-radius: 5mm; padding: .2mm 1.8mm; margin-left: 1mm; vertical-align: .2mm; }
  .chip.bad { color: var(--bad); background: var(--bad-soft); }
  .chip.watch { color: var(--watch); background: var(--watch-soft); }

  dl.read { margin: 0; display: grid; grid-template-columns: 22mm 1fr; row-gap: 1.1mm; column-gap: 3mm; }
  dl.read dt { font-weight: 600; }
  dl.read dd { margin: 0; color: var(--ink-soft); }

  .flow { display: grid; grid-template-columns: 1fr 5mm 1fr 5mm 1fr; align-items: stretch; margin-top: .6mm; }
  .step { background: var(--canvas); border-radius: 2.6mm; padding: 2.4mm 3mm; }
  .step .k { font-size: 6.8pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-muted); }
  .step p { margin-top: .8mm; font-weight: 600; font-size: 9pt; }
  .step span { display: block; font-size: 7.8pt; color: var(--ink-soft); font-weight: 400; margin-top: .6mm; }
  .arrow { display: flex; align-items: center; justify-content: center; color: var(--ink-muted); font-size: 10pt; }
  .outcomes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin-top: 2.6mm; }
  .outcome { display: flex; gap: 2mm; align-items: flex-start; font-size: 7.8pt; color: var(--ink-soft); }
  .tick { flex: none; width: 4mm; height: 4mm; border-radius: 50%; background: var(--good-soft); color: var(--good); font-size: 7pt; font-weight: 700; display: flex; align-items: center; justify-content: center; margin-top: .3mm; }

  footer { margin-top: auto; display: flex; justify-content: space-between; align-items: center; gap: 8mm; font-size: 7.8pt; color: var(--ink-muted); border-top: .25mm solid var(--line); padding-top: 2.4mm; }
`;
