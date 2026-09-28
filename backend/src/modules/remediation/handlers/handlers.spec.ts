import { describe, expect, it } from 'vitest';
import { MAX_PAGE_SPECS } from '../remediation.constants.js';
import { finding, page, SITE, snapshot } from '../testing/snapshot.fixture.js';
import { HANDLERS } from './handler.registry.js';
import { pageIssuesHandler } from './page.handlers.js';
import { aeoHandler, promptTarget, socialHandler } from './presence.handlers.js';
import { agentReadinessHandler, cdnHandler, robotsHandler, schemaHandler, sitemapHandler } from './technical.handlers.js';

const byKey = (drafts: { problemKey: string }[]) => drafts.map((d) => d.problemKey).sort();

describe('robots handler', () => {
  it('splits search/live-fetch blocks (generated fix) from training blocks (client decision)', () => {
    const drafts = robotsHandler.detect(snapshot());
    expect(byKey(drafts)).toEqual(['robots.training-crawlers-blocked', 'robots.unblock-ai-crawlers']);

    const unblock = drafts.find((d) => d.problemKey === 'robots.unblock-ai-crawlers')!;
    expect(unblock.method).toBe('GENERATED');
    expect(unblock.severity).toBe('HIGH');
    expect(unblock.artifact?.path).toBe('/robots.txt');
    expect(unblock.acceptance).toEqual({ kind: 'robots-allows', bots: ['OAI-SearchBot', 'PerplexityBot'] });
    // Training bots are never silently unblocked.
    expect(unblock.artifact!.content).not.toMatch(/User-agent: GPTBot\nAllow: \//);

    const training = drafts.find((d) => d.problemKey === 'robots.training-crawlers-blocked')!;
    expect(training.needsClientDecision).toBe(true);
    expect(training.artifact).toBeUndefined();
  });

  it('a missing robots.txt gets a new file that declares the known sitemap', () => {
    const s = snapshot();
    s.technicalAudit!.findings[0] = finding('robots', 'fail', { robotsTxtFound: false, statusCode: 404 });
    const [d] = robotsHandler.detect(s);
    expect(d.problemKey).toBe('robots.missing');
    expect(d.artifact!.content).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(d.acceptance).toEqual({ kind: 'robots-exists' });
  });

  it('emits nothing when the robots check passed or did not run', () => {
    const s = snapshot();
    s.technicalAudit!.findings[0] = finding('robots', 'error', {});
    expect(robotsHandler.detect(s)).toEqual([]);
  });
});

describe('sitemap handler', () => {
  it('generates the robots.txt Sitemap line when the sitemap exists but is not declared', () => {
    const drafts = sitemapHandler.detect(snapshot());
    expect(byKey(drafts)).toEqual(['sitemap.not-declared-in-robots']);
    expect(drafts[0].artifact!.content).toBe(`Sitemap: ${SITE}/sitemap.xml`);
    expect(drafts[0].sources.map((s) => s.findingRef).sort()).toEqual(['robots', 'sitemap']);
  });

  it('a missing sitemap is instructions, verified by the next audit', () => {
    const s = snapshot();
    s.technicalAudit!.findings[2] = finding('sitemap', 'fail', { found: false, triedUrls: [] });
    const [d] = sitemapHandler.detect(s);
    expect(d.problemKey).toBe('sitemap.missing');
    expect(d.acceptance.kind).toBe('finding-absent');
  });
});

describe('schema handler', () => {
  it('builds Organization JSON-LD from confirmed facts and only requires fields it could fill', () => {
    const [d] = schemaHandler.detect(snapshot());
    expect(d.problemKey).toBe('schema.organization-missing');
    expect(d.artifact!.content).toContain('"name": "Acme"');
    expect(d.artifactError).toMatch(/logo/);
    expect(d.acceptance).toEqual({ kind: 'json-ld-has', url: SITE, type: 'Organization', fields: ['name', 'url', 'sameAs', 'description'] });
  });

  it('an existing but incomplete block gets a merge fix for the missing fields', () => {
    const s = snapshot();
    s.technicalAudit!.findings[1] = finding('schema', 'pass', { schemasFound: true, hasOrganization: true, missingFields: ['sameAs', 'logo'] });
    const [d] = schemaHandler.detect(s);
    expect(d.problemKey).toBe('schema.organization-incomplete');
    expect(d.acceptance).toMatchObject({ fields: ['sameAs'] });
  });

  it('no company profile → no invented name; falls back to the project name only for the block', () => {
    const [d] = schemaHandler.detect(snapshot({ company: null }));
    expect(d.artifact!.content).toContain('"name": "Acme"');
    expect(d.artifact!.content).not.toContain('sameAs');
  });
});

describe('page issues handler', () => {
  it('per-page specs for page-specific fixes, one grouped spec per template-level issue', () => {
    const drafts = pageIssuesHandler.detect(snapshot());
    const keys = drafts.map((d) => `${d.problemKey}@${d.target}`).sort();
    expect(keys).toEqual([
      `page.canonical-missing@${SITE}/pricing`,
      `page.meta-missing@${SITE}/pricing`,
      `page.thin-content@${SITE}`,
      `page.title-too-long@${SITE}/about`,
    ]);
    const thin = drafts.find((d) => d.problemKey === 'page.thin-content')!;
    expect(thin.evidence).toMatchObject({ pageCount: 2 });
    const canonical = drafts.find((d) => d.problemKey === 'page.canonical-missing')!;
    expect(canonical.artifact!.content).toBe(`<link rel="canonical" href="${SITE}/pricing" />`);
    expect(drafts.find((d) => d.problemKey === 'page.meta-missing')!.method).toBe('LLM_DRAFT');
  });

  it('caps per-page specs so a large crawl cannot flood the plan', () => {
    const pages = Array.from({ length: 200 }, (_, i) => page(`${SITE}/p${i}`, ['meta-missing', 'h1-missing']));
    const s = snapshot();
    s.technicalAudit!.pages = pages;
    const perPage = pageIssuesHandler.detect(s).filter((d) => d.target !== SITE);
    expect(perPage.length).toBe(MAX_PAGE_SPECS);
  });

  it('noindex is a client decision', () => {
    const s = snapshot();
    s.technicalAudit!.pages = [page(`${SITE}/x`, ['noindex'])];
    expect(pageIssuesHandler.detect(s)[0].needsClientDecision).toBe(true);
  });
});

describe('presence handlers', () => {
  it('dormant social platforms become off-site instructions; active ones produce nothing', () => {
    const drafts = socialHandler.detect(snapshot());
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ problemKey: 'social.dormant-platform', target: 'social:linkedin', fixClass: 'OFF_SITE' });
    expect(drafts[0].sources[0].findingRef).toBe('linkedin:dormant-platform');
  });

  it('losing AEO prompts are keyed by prompt text, not the per-audit observation id', () => {
    const [d] = aeoHandler.detect(snapshot());
    expect(d.target).toBe(promptTarget('best widget tool  for small teams'));
    expect(d.sources[0].findingRef).toBe('losing-prompt:44444444-4444-4444-4444-444444444444');
    expect(d.steps[0]).toContain('Globex');
  });
});

describe('cdn + agent readiness', () => {
  it('cdn block names the vendor', () => {
    const s = snapshot();
    s.technicalAudit!.findings.push(finding('cdn-inferred', 'fail', { cdnVendor: 'Cloudflare', blockedBots: ['PerplexityBot'] }, 'high'));
    const [d] = cdnHandler.detect(s);
    expect(d.title).toContain('Cloudflare');
    expect(d.steps.join(' ')).toContain('Security');
  });

  it('an llms.txt issue gets a generated llms.txt; other issues get their own recommendation', () => {
    const s = snapshot();
    s.technicalAudit!.findings.push(
      finding('agent-readiness', 'fail', {
        issues: [
          { id: 'llms-txt', name: 'llms.txt present', result: 'fail', recommendation: 'Add llms.txt' },
          { id: 'mcp', name: 'MCP endpoint', result: 'warn', recommendation: 'Expose an MCP server card.' },
          { id: 'https', name: 'HTTPS', result: 'pass', recommendation: '' },
        ],
      }),
    );
    const drafts = agentReadinessHandler.detect(s);
    expect(byKey(drafts)).toEqual(['agent.llms-txt', 'agent.mcp']);
    expect(drafts.find((d) => d.problemKey === 'agent.llms-txt')!.artifact!.path).toBe('/llms.txt');
    expect(drafts.find((d) => d.problemKey === 'agent.mcp')!.steps).toEqual(['Expose an MCP server card.']);
  });
});

describe('registry', () => {
  it('every handler is pure over the fixture: same input, same output', () => {
    for (const h of HANDLERS) {
      expect(JSON.stringify(h.detect(snapshot()))).toBe(JSON.stringify(h.detect(snapshot())));
    }
  });

  it('no sources at all → no drafts from any handler', () => {
    const empty = snapshot({ technicalAudit: null, socialActivity: null, aeoAudit: null });
    expect(HANDLERS.flatMap((h) => h.detect(empty))).toEqual([]);
  });
});
