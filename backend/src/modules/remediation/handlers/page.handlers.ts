/**
 * Handler for the technical audit's per-page SEO issues (`audit_pages`).
 *
 * Issues where the fix is specific to one page (title, meta description,
 * h1, canonical) become one spec per page, worst pages first, capped at
 * `MAX_PAGE_SPECS`. Everything else becomes one site-level spec per issue
 * code with the affected pages listed — the fix is the same template change
 * for all of them, and 150 identical rows help no one.
 *
 * Title/meta specs are `LLM_DRAFT`: sync writes the steps; an operator can
 * ask for a drafted rewrite on demand (`RemediationDraftService`).
 *
 * @module remediation/handlers/page.handlers
 */

import { SEO_BANDS } from '../../technical-audit/technical-audit.constants.js';
import type { PageIssueCode } from '../../technical-audit/technical-audit.types.js';
import { canonicalTag } from '../generators/markup.generator.js';
import { MAX_GROUPED_PAGES_LISTED, MAX_PAGE_SPECS, PER_PAGE_ISSUES } from '../remediation.constants.js';
import type { FixSpecDraft, RemediationHandler, SnapshotPage, SourceSnapshot } from '../remediation.types.js';
import { technicalRef } from './common.js';

type PerPageIssue = (typeof PER_PAGE_ISSUES)[number];
const PER_PAGE = new Set<string>(PER_PAGE_ISSUES);

function perPageDraft(snapshot: SourceSnapshot, page: SnapshotPage, issue: PerPageIssue): FixSpecDraft {
  const s = page.signals;
  const base = {
    target: page.url,
    groupKey: `page.${issue.split('-')[0]}`,
    sources: [technicalRef(snapshot, 'page-inventory')],
    acceptance: { kind: 'page-issue-absent' as const, url: page.url, issues: [issue as PageIssueCode] },
    effort: 'LOW' as const,
  };

  switch (issue) {
    case 'title-missing':
    case 'title-too-short':
    case 'title-too-long':
      return {
        ...base,
        problemKey: `page.${issue}`,
        fixClass: 'CONTENT',
        method: 'LLM_DRAFT',
        severity: issue === 'title-missing' ? 'HIGH' : 'MEDIUM',
        title: issue === 'title-missing' ? 'Add a page title' : `Rewrite the page title (${issue === 'title-too-short' ? 'too short' : 'too long'})`,
        evidence: { currentTitle: s.title ?? null, titleLength: s.titleLength ?? null, h1Count: s.h1Count ?? null },
        steps: [
          `Write a <title> of ${SEO_BANDS.titleMin}–${SEO_BANDS.titleMax} characters that says what this page is about, with the brand name at the end.`,
          'Use "Draft copy" on this fix for a suggested rewrite, then edit it before publishing.',
        ],
      };
    case 'meta-missing':
    case 'meta-too-short':
    case 'meta-too-long':
      return {
        ...base,
        problemKey: `page.${issue}`,
        fixClass: 'CONTENT',
        method: 'LLM_DRAFT',
        severity: 'MEDIUM',
        title: issue === 'meta-missing' ? 'Add a meta description' : `Rewrite the meta description (${issue === 'meta-too-short' ? 'too short' : 'too long'})`,
        evidence: { currentTitle: s.title ?? null, currentMeta: s.metaDescription ?? null, metaDescLength: s.metaDescLength ?? null },
        steps: [
          `Write a meta description of ${SEO_BANDS.metaMin}–${SEO_BANDS.metaMax} characters: a direct one- or two-sentence answer to "what is on this page and who is it for".`,
          'Use "Draft copy" on this fix for a suggested rewrite, then edit it before publishing.',
        ],
      };
    case 'h1-missing':
    case 'h1-multiple':
      return {
        ...base,
        problemKey: `page.${issue}`,
        fixClass: 'CODE',
        method: 'INSTRUCTIONS',
        severity: 'MEDIUM',
        title: issue === 'h1-missing' ? 'Give the page one main heading (h1)' : 'Use exactly one main heading (h1)',
        evidence: { h1Count: s.h1Count ?? null, currentTitle: s.title ?? null },
        steps: [
          issue === 'h1-missing'
            ? 'Add one <h1> near the top of the page stating the page topic.'
            : `The page has ${s.h1Count ?? 'several'} <h1> elements. Keep the one that names the page topic and change the others to <h2>.`,
        ],
      };
    case 'canonical-missing':
    case 'canonical-malformed':
    case 'canonical-cross-domain':
      return {
        ...base,
        problemKey: `page.${issue}`,
        fixClass: 'CODE',
        method: 'GENERATED',
        severity: issue === 'canonical-cross-domain' ? 'HIGH' : 'MEDIUM',
        title: issue === 'canonical-missing' ? 'Add a canonical tag' : 'Fix the canonical tag',
        evidence: { currentCanonical: s.canonical ?? null },
        needsClientDecision: issue === 'canonical-cross-domain',
        artifact: { kind: 'html-snippet', language: 'html', placement: 'Inside <head> on this page (replace any existing canonical tag)', content: canonicalTag(page.url) },
        steps:
          issue === 'canonical-cross-domain'
            ? ['The canonical tag points to another domain, which tells search and AI engines to credit that domain instead. Confirm with the client this is not intentional (e.g. syndicated content) before changing it.', 'If not intentional, replace it with the generated tag.']
            : ['Put the generated tag inside <head> on this page, replacing any existing canonical tag.'],
      };
  }
}

const GROUPED_TITLES: Partial<Record<PageIssueCode, string>> = {
  'thin-content': 'Expand thin pages',
  'images-missing-alt': 'Add alt text to images',
  'duplicate-content': 'Resolve duplicate pages',
  noindex: 'Review pages hidden from search (noindex)',
  'heading-level-skipped': 'Fix skipped heading levels',
  'json-ld-missing': 'Add structured data to key pages',
  'json-ld-invalid': 'Fix invalid structured data',
  'page-error': 'Fix pages returning errors',
  'url-too-long': 'Shorten long URLs',
  'url-has-uppercase': 'Use lowercase URLs',
  'url-has-underscore': 'Use hyphens instead of underscores in URLs',
  'url-excess-params': 'Reduce URL query parameters',
};

const GROUPED_STEPS: Partial<Record<PageIssueCode, string[]>> = {
  'thin-content': [`Each listed page has fewer than ${SEO_BANDS.minWords} words of readable text. Add a clear answer to the question the page targets, specifics, and an FAQ where useful, or merge the page into a stronger one.`],
  'images-missing-alt': ['Add a short, descriptive alt attribute to every meaningful image; use alt="" for decorative ones.'],
  'duplicate-content': ['Pick one page as the original for each duplicate set; point the others at it with a canonical tag or a 301 redirect.'],
  noindex: ['Each listed page has a noindex robots meta tag. Confirm with the client whether they should be hidden; remove the tag from any that should appear in search and AI answers.'],
  'heading-level-skipped': ['Headings should go h1 → h2 → h3 without skipping a level. Adjust the heading tags in the page template.'],
  'json-ld-missing': ['Add page-appropriate JSON-LD (e.g. Article, Product, FAQPage, Service) to the listed page templates.'],
  'json-ld-invalid': ['The JSON-LD on these pages does not parse. Run it through a JSON validator and fix the syntax in the page template.'],
  'page-error': ['These pages returned an error status. Fix or redirect them (301) to the closest working page, and remove them from the sitemap.'],
  'url-too-long': ['Shorten the URLs of new pages; for existing ones, only change a URL with a 301 redirect from the old address.'],
  'url-has-uppercase': ['Use lowercase URLs; redirect (301) mixed-case URLs to their lowercase version.'],
  'url-has-underscore': ['Use hyphens in URLs; redirect (301) old underscore URLs to the hyphenated version.'],
  'url-excess-params': ['Avoid indexable URLs with many query parameters; add canonical tags pointing at the clean URL.'],
};

/** Codes whose fix changes what search engines index or credit — a client call, not ours. */
const DECISION_CODES = new Set<PageIssueCode>(['noindex', 'duplicate-content', 'url-too-long', 'url-has-uppercase', 'url-has-underscore']);

export const pageIssuesHandler: RemediationHandler = {
  id: 'page-issues',
  detect(snapshot) {
    const pages = snapshot.technicalAudit?.pages ?? [];
    if (pages.length === 0) return [];
    const drafts: FixSpecDraft[] = [];

    // Per-page specs, worst pages first (pages arrive sorted by score asc).
    for (const page of pages) {
      for (const issue of page.issues) {
        if (!PER_PAGE.has(issue)) continue;
        if (drafts.length >= MAX_PAGE_SPECS) break;
        drafts.push(perPageDraft(snapshot, page, issue as PerPageIssue));
      }
    }

    // One site-level spec per remaining issue code.
    const grouped = new Map<PageIssueCode, string[]>();
    for (const page of pages) {
      for (const issue of page.issues) {
        if (PER_PAGE.has(issue)) continue;
        const list = grouped.get(issue) ?? [];
        list.push(page.url);
        grouped.set(issue, list);
      }
    }
    for (const [issue, urls] of grouped) {
      drafts.push({
        problemKey: `page.${issue}`,
        target: snapshot.siteUrl,
        fixClass: issue.startsWith('url-') || issue === 'page-error' || issue.startsWith('json-ld') || issue === 'heading-level-skipped' ? 'CODE' : 'CONTENT',
        method: 'INSTRUCTIONS',
        groupKey: `page.${issue.split('-')[0]}`,
        severity: issue === 'page-error' || issue === 'noindex' ? 'HIGH' : 'LOW',
        effort: urls.length > 10 ? 'HIGH' : 'MEDIUM',
        title: `${GROUPED_TITLES[issue] ?? issue} (${urls.length} page${urls.length === 1 ? '' : 's'})`,
        evidence: { pageCount: urls.length, pages: urls.slice(0, MAX_GROUPED_PAGES_LISTED) },
        sources: [technicalRef(snapshot, 'page-inventory')],
        needsClientDecision: DECISION_CODES.has(issue),
        steps: GROUPED_STEPS[issue] ?? [`Resolve "${issue}" on the listed pages.`],
        acceptance: { kind: 'finding-absent', module: 'technical-audit', findingRef: `page-inventory:${issue}` },
      });
    }
    return drafts;
  },
};
