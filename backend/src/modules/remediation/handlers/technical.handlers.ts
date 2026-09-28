/**
 * Handlers for the technical audit's site-level checks: robots.txt, CDN
 * bot-blocking, JS rendering, Core Web Vitals, schema.org, sitemap and agent
 * readiness. Each reads the check's own `detail` and either builds the fix
 * (robots.txt, JSON-LD, llms.txt, a sitemap line) or writes concrete steps.
 *
 * @module remediation/handlers/technical.handlers
 */

import { organizationJsonLd, llmsTxt, ORG_FIELDS } from '../generators/markup.generator.js';
import { newRobotsTxt, sitemapLine, unblockBots } from '../generators/robots-txt.generator.js';
import { MAX_CWV_AUDITS_LISTED } from '../remediation.constants.js';
import type { FixSpecDraft, RemediationHandler } from '../remediation.types.js';
import { failedFinding, level, num, ranFinding, str, strArray, technicalRef, text } from './common.js';

/** The technical audit stores the first 2,000 chars of robots.txt — a copy that long may be cut off. */
const ROBOTS_STORED_LIMIT = 2000;

export const robotsHandler: RemediationHandler = {
  id: 'robots',
  detect(snapshot) {
    const f = failedFinding(snapshot, 'robots');
    if (!f) return [];
    const d = f.detail;
    const site = snapshot.siteUrl;
    const sources = [technicalRef(snapshot, 'robots')];
    const out: FixSpecDraft[] = [];

    if (d['robotsTxtFound'] === false) {
      const sitemapUrl = str(ranFinding(snapshot, 'sitemap')?.detail['sitemapUrl']);
      out.push({
        problemKey: 'robots.missing',
        target: site,
        fixClass: 'CONFIG',
        method: 'GENERATED',
        groupKey: 'robots',
        severity: 'MEDIUM',
        effort: 'LOW',
        title: 'Publish a robots.txt that allows AI crawlers',
        evidence: { robotsUrl: d['robotsUrl'], statusCode: d['statusCode'] },
        sources,
        artifact: { kind: 'file', path: '/robots.txt', language: 'text', content: newRobotsTxt(sitemapUrl) },
        steps: [
          'Save the generated file as /robots.txt at the site root (the domain root, not a sub-folder).',
          'Deploy, then open /robots.txt in a browser and confirm it loads with status 200.',
        ],
        acceptance: { kind: 'robots-exists' },
      });
      return out;
    }

    const raw = typeof d['rawContent'] === 'string' ? d['rawContent'] : '';
    const unblock = [...strArray(d['blockedSearch']), ...strArray(d['blockedLiveFetch'])];
    if (unblock.length > 0) {
      const result = unblockBots(raw, unblock, { truncated: raw.length >= ROBOTS_STORED_LIMIT });
      const steps = [
        `These AI search/assistant crawlers are blocked at the site root: ${unblock.join(', ')}. Blocking them removes the site from AI answers.`,
        result.content
          ? 'Replace /robots.txt with the generated file. It only adds one group at the top; every existing rule below is unchanged, and any non-root blocks these bots already had are kept.'
          : `In /robots.txt, remove the "Disallow: /" rule that applies to ${unblock.join(', ')} (or add a group for them with "Allow: /").`,
        'Deploy, then use "Check my site now" on this fix to confirm.',
      ];
      if (result.untargetable.length > 0) {
        steps.splice(2, 0, `${result.untargetable.join(', ')} cannot be named in robots.txt by token; they follow the "User-agent: *" group — check that group does not block "/".`);
      }
      out.push({
        problemKey: 'robots.unblock-ai-crawlers',
        target: site,
        fixClass: 'CONFIG',
        method: result.content ? 'GENERATED' : 'INSTRUCTIONS',
        groupKey: 'robots',
        severity: strArray(d['blockedSearch']).length > 0 ? 'HIGH' : 'MEDIUM',
        effort: 'LOW',
        title: 'Unblock AI search and assistant crawlers in robots.txt',
        evidence: { blockedSearch: d['blockedSearch'], blockedLiveFetch: d['blockedLiveFetch'], robotsUrl: d['robotsUrl'] },
        sources,
        artifact: result.content ? { kind: 'file', path: '/robots.txt', language: 'text', content: result.content } : undefined,
        artifactError: result.error,
        steps,
        acceptance: { kind: 'robots-allows', bots: unblock },
      });
    }

    const training = strArray(d['blockedTraining']);
    if (training.length > 0) {
      out.push({
        problemKey: 'robots.training-crawlers-blocked',
        target: site,
        fixClass: 'CONFIG',
        method: 'INSTRUCTIONS',
        groupKey: 'robots',
        severity: 'LOW',
        effort: 'LOW',
        title: 'Decide whether AI training crawlers may read the site',
        evidence: { blockedTraining: training },
        sources,
        needsClientDecision: true,
        steps: [
          `Training crawlers are blocked: ${training.join(', ')}. This keeps the site out of model training data, and is often deliberate.`,
          'Ask the client. If they approve, remove the "Disallow: /" rule for these bots in /robots.txt. If they decline, dismiss this fix.',
        ],
        acceptance: { kind: 'robots-allows', bots: training },
      });
    }
    return out;
  },
};

export const sitemapHandler: RemediationHandler = {
  id: 'sitemap',
  detect(snapshot) {
    const f = ranFinding(snapshot, 'sitemap');
    if (!f) return [];
    const d = f.detail;
    const site = snapshot.siteUrl;
    const out: FixSpecDraft[] = [];

    if (d['found'] === false) {
      out.push({
        problemKey: 'sitemap.missing',
        target: site,
        fixClass: 'CODE',
        method: 'INSTRUCTIONS',
        groupKey: 'sitemap',
        severity: level(f.severity),
        effort: 'MEDIUM',
        title: 'Publish an XML sitemap',
        evidence: { triedUrls: d['triedUrls'] },
        sources: [technicalRef(snapshot, 'sitemap')],
        steps: [
          'Generate /sitemap.xml listing every public page, with a <lastmod> date per URL (most CMSs and frameworks have a built-in or plugin generator).',
          'Make it regenerate automatically whenever a page is published or updated.',
          `Declare it in /robots.txt with the line "Sitemap: ${site}/sitemap.xml".`,
        ],
        acceptance: { kind: 'finding-absent', module: 'technical-audit', findingRef: 'sitemap' },
      });
      return out;
    }

    if (f.status === 'fail') {
      out.push({
        problemKey: 'sitemap.stale',
        target: site,
        fixClass: 'CODE',
        method: 'INSTRUCTIONS',
        groupKey: 'sitemap',
        severity: level(f.severity),
        effort: 'MEDIUM',
        title: 'Keep the sitemap up to date',
        evidence: { sitemapUrl: d['sitemapUrl'], staleDays: d['staleDays'], newestLastmod: d['newestLastmod'], urlCount: d['urlCount'] },
        sources: [technicalRef(snapshot, 'sitemap')],
        steps: [
          `The newest <lastmod> in ${text(d['sitemapUrl']) || 'the sitemap'} is ${text(d['staleDays'])} days old.`,
          'Switch the sitemap from a one-time file to one generated on publish, so <lastmod> reflects real page changes.',
          'Only change <lastmod> when the page content really changes — crawlers learn to ignore dates that always move.',
        ],
        acceptance: { kind: 'finding-absent', module: 'technical-audit', findingRef: 'sitemap' },
      });
    }

    const robotsFound = ranFinding(snapshot, 'robots')?.detail['robotsTxtFound'] === true;
    const sitemapUrl = str(d['sitemapUrl']);
    if (d['declaredInRobots'] === false && robotsFound && sitemapUrl) {
      out.push({
        problemKey: 'sitemap.not-declared-in-robots',
        target: site,
        fixClass: 'CONFIG',
        method: 'GENERATED',
        groupKey: 'robots',
        severity: 'LOW',
        effort: 'LOW',
        title: 'Declare the sitemap in robots.txt',
        evidence: { sitemapUrl },
        sources: [technicalRef(snapshot, 'sitemap'), technicalRef(snapshot, 'robots')],
        artifact: { kind: 'file', path: '/robots.txt', language: 'text', placement: 'Add this line at the end of /robots.txt', content: sitemapLine(sitemapUrl) },
        steps: ['Add the generated line to the end of /robots.txt and deploy.'],
        acceptance: { kind: 'robots-declares-sitemap' },
      });
    }
    return out;
  },
};

export const schemaHandler: RemediationHandler = {
  id: 'schema',
  detect(snapshot) {
    const f = ranFinding(snapshot, 'schema');
    if (!f) return [];
    const d = f.detail;
    const hasOrg = d['hasOrganization'] === true;
    const missing = strArray(d['missingFields']);
    if (hasOrg && missing.length === 0) return [];

    const site = snapshot.siteUrl;
    const facts = snapshot.company ?? { name: snapshot.projectName, url: site, description: null, logoUrl: null, sameAs: [], offerings: [] };
    const generated = organizationJsonLd(facts);
    const canFill = ORG_FIELDS.filter((field) => !generated.missing.includes(field));

    const artifactError = !generated.snippet
      ? 'The company name is not confirmed yet (Discovery profile), so no Organization block can be generated.'
      : generated.missing.length > 0
        ? `Not in the confirmed company profile, so left out: ${generated.missing.join(', ')}. Add them once the client confirms them.`
        : undefined;

    if (!hasOrg) {
      return [
        {
          problemKey: 'schema.organization-missing',
          target: site,
          fixClass: 'CODE',
          method: 'GENERATED',
          groupKey: 'schema',
          severity: level(f.severity === 'low' ? 'medium' : f.severity),
          effort: 'LOW',
          title: 'Add Organization structured data to the homepage',
          evidence: { schemaTypes: d['schemaTypes'], schemasFound: d['schemasFound'] },
          sources: [technicalRef(snapshot, 'schema')],
          artifact: generated.snippet
            ? { kind: 'json-ld', language: 'html', placement: 'Inside <head> on the homepage', content: generated.snippet }
            : undefined,
          artifactError,
          steps: [
            'Paste the generated <script type="application/ld+json"> block inside <head> on the homepage.',
            'Check it with a structured-data testing tool, deploy, then use "Check my site now" to confirm.',
          ],
          acceptance: { kind: 'json-ld-has', url: site, type: 'Organization', fields: canFill.length > 0 ? [...canFill] : ['name', 'url'] },
        },
      ];
    }

    return [
      {
        problemKey: 'schema.organization-incomplete',
        target: site,
        fixClass: 'CODE',
        method: 'GENERATED',
        groupKey: 'schema',
        severity: 'LOW',
        effort: 'LOW',
        title: `Complete the Organization structured data (${missing.join(', ')})`,
        evidence: { missingFields: missing, schemaTypes: d['schemaTypes'] },
        sources: [technicalRef(snapshot, 'schema')],
        artifact: generated.snippet
          ? { kind: 'json-ld', language: 'html', placement: 'Merge these properties into the existing Organization block', content: generated.snippet }
          : undefined,
        artifactError,
        steps: [
          `The existing Organization block is missing: ${missing.join(', ')}.`,
          'Copy those properties from the generated block into the existing one (keep one Organization block, not two).',
          'Deploy, then use "Check my site now" to confirm.',
        ],
        acceptance: { kind: 'json-ld-has', url: site, type: 'Organization', fields: missing.filter((m) => canFill.includes(m as never)) },
      },
    ];
  },
};

export const cdnHandler: RemediationHandler = {
  id: 'cdn',
  detect(snapshot) {
    const f = failedFinding(snapshot, 'cdn-inferred');
    if (!f) return [];
    const d = f.detail;
    const vendor = str(d['cdnVendor']);
    const blocked = strArray(d['blockedBots']);
    return [
      {
        problemKey: 'cdn.bot-blocked',
        target: snapshot.siteUrl,
        fixClass: 'CONFIG',
        method: 'INSTRUCTIONS',
        groupKey: 'cdn',
        severity: level(f.severity),
        effort: 'LOW',
        title: `Stop ${vendor ?? 'the CDN/firewall'} from blocking AI crawlers`,
        evidence: { cdnVendor: vendor, blockedBots: blocked, detectedFromHeaders: d['detectedFromHeaders'] },
        sources: [technicalRef(snapshot, 'cdn-inferred')],
        steps: [
          `Requests identifying as ${blocked.join(', ') || 'AI crawlers'} are refused at the ${vendor ?? 'CDN/firewall'} layer, before robots.txt is even read.`,
          vendor === 'Cloudflare'
            ? 'In Cloudflare: Security → Bots, turn off "Block AI bots" / AI Scrapers and Crawlers for search and assistant bots, and check WAF custom rules for user-agent blocks.'
            : 'In the CDN/WAF settings, find bot-management or user-agent rules and allow these crawlers (verified-bot allow lists usually cover them).',
          'Re-run the technical audit to confirm; this cannot be checked from outside without the audit\'s probes.',
        ],
        acceptance: { kind: 'finding-absent', module: 'technical-audit', findingRef: 'cdn-inferred' },
      },
    ];
  },
};

export const jsRenderHandler: RemediationHandler = {
  id: 'js-render',
  detect(snapshot) {
    const f = failedFinding(snapshot, 'js-render');
    if (!f) return [];
    const loss = num(f.detail['contentLossPercent']);
    return [
      {
        problemKey: 'render.js-dependent',
        target: snapshot.siteUrl,
        fixClass: 'CODE',
        method: 'HUMAN',
        groupKey: 'rendering',
        severity: level(f.severity),
        effort: 'HIGH',
        title: 'Serve page content in the HTML, not only via JavaScript',
        evidence: { contentLossPercent: loss, textLengthWithoutJs: f.detail['textLengthWithoutJs'], textLengthWithJs: f.detail['textLengthWithJs'] },
        sources: [technicalRef(snapshot, 'js-render')],
        steps: [
          `${loss ?? 'Much'}% of the homepage text only appears after JavaScript runs. Most AI crawlers do not run JavaScript, so they see a near-empty page.`,
          'Have a developer enable server-side rendering or static generation for public pages (e.g. Next.js SSR/SSG, Nuxt SSR, or a prerender service).',
          'Check by viewing the page source (not the inspector): the main text should be in the HTML.',
        ],
        acceptance: { kind: 'finding-absent', module: 'technical-audit', findingRef: 'js-render' },
      },
    ];
  },
};

export const cwvHandler: RemediationHandler = {
  id: 'cwv',
  detect(snapshot) {
    const f = failedFinding(snapshot, 'cwv');
    if (!f) return [];
    const d = f.detail;
    const audits = (Array.isArray(d['failedAudits']) ? d['failedAudits'] : [])
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && a['category'] === 'performance')
      .slice(0, MAX_CWV_AUDITS_LISTED);
    return [
      {
        problemKey: 'performance.core-web-vitals',
        target: snapshot.siteUrl,
        fixClass: 'CODE',
        method: 'INSTRUCTIONS',
        groupKey: 'performance',
        severity: level(f.severity),
        effort: 'MEDIUM',
        title: 'Improve page speed (Core Web Vitals)',
        evidence: { lcp: d['lcp'], cls: d['cls'], inp: d['inp'], lcpStatus: d['lcpStatus'], clsStatus: d['clsStatus'], inpStatus: d['inpStatus'], performanceScore: d['performanceScore'] },
        sources: [technicalRef(snapshot, 'cwv')],
        steps: [
          `Largest Contentful Paint: ${text(d['lcpStatus'])}, layout shift: ${text(d['clsStatus'])}, interaction delay: ${text(d['inpStatus'])}.`,
          ...audits.map((a) => `Fix: ${text(a['title'])}${text(a['displayValue']) ? ` (${text(a['displayValue'])})` : ''}.`),
          'Re-run the technical audit to confirm.',
        ],
        acceptance: { kind: 'finding-absent', module: 'technical-audit', findingRef: 'cwv' },
      },
    ];
  },
};

const PASSING_RESULTS = new Set(['pass', 'passed', 'ok', 'success', 'good']);
const MAX_AGENT_ISSUES = 10;

export const agentReadinessHandler: RemediationHandler = {
  id: 'agent-readiness',
  detect(snapshot) {
    const f = failedFinding(snapshot, 'agent-readiness');
    if (!f) return [];
    const issues = (Array.isArray(f.detail['issues']) ? f.detail['issues'] : [])
      .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
      .filter((i) => !PASSING_RESULTS.has(text(i['result']).toLowerCase()))
      .slice(0, MAX_AGENT_ISSUES);

    return issues.map((issue): FixSpecDraft => {
      const id = str(issue['id']) ?? str(issue['name']) ?? 'unknown';
      const name = str(issue['name']) ?? id;
      const isLlmsTxt = /llms/i.test(`${id} ${name}`);
      const base = {
        problemKey: `agent.${id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        target: snapshot.siteUrl,
        groupKey: 'agent-readiness',
        severity: 'LOW' as const,
        effort: 'LOW' as const,
        title: `Agent readiness: ${name}`,
        evidence: { id, name, result: issue['result'], details: issue['details'] },
        sources: [technicalRef(snapshot, 'agent-readiness')],
        acceptance: { kind: 'finding-absent' as const, module: 'technical-audit' as const, findingRef: 'agent-readiness' },
      };
      if (isLlmsTxt) {
        const content = snapshot.company ? llmsTxt(snapshot.company, snapshot.technicalAudit?.pages ?? []) : null;
        return {
          ...base,
          fixClass: 'CODE',
          method: 'GENERATED',
          artifact: content ? { kind: 'file', path: '/llms.txt', language: 'markdown', content } : undefined,
          artifactError: content ? undefined : 'The company name is not confirmed yet (Discovery profile), so llms.txt cannot be generated.',
          steps: ['Save the generated file as /llms.txt at the site root and deploy.', 'Review the page list and summary with the client before publishing.'],
        };
      }
      return {
        ...base,
        fixClass: 'CODE',
        method: 'INSTRUCTIONS',
        steps: [str(issue['recommendation']) ?? `Resolve "${name}" as described in the agent-readiness report.`],
      };
    });
  },
};
