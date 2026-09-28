import { briefFileName, buildFixBrief, packFileName, renderFixBriefHtml } from './fix-brief.js';
import { renderFixPackMarkdown, type FixPack } from './fix-pack.js';

type Fix = FixPack['fixes'][number];

function fix(over: Partial<Fix>): Fix {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    problemKey: 'x',
    target: 'https://acme.test',
    fixClass: 'CODE',
    method: 'INSTRUCTIONS',
    groupKey: 'page.meta',
    severity: 'MEDIUM',
    effort: 'LOW',
    status: 'OPEN',
    title: 'A fix',
    evidence: {},
    artifact: null,
    artifactError: null,
    steps: ['Do it.'],
    acceptance: { kind: 'finding-absent', module: 'technical-audit', findingRef: 'x' },
    draft: null,
    awaitingClientDecision: false,
    ...over,
  };
}

function pack(fixes: Fix[]): FixPack {
  return { project: { id: 'p1', name: 'Acme', domain: 'acme.test' }, generatedAt: '2026-09-28T00:00:00.000Z', fixes };
}

const brandPages = ['a', 'b', 'c', 'd', 'e', 'f'].map((s) =>
  fix({ groupKey: 'page.h1', target: `https://acme.test/brand/${s}`, title: 'Use exactly one main heading (h1)' }),
);

const sample = pack([
  fix({ groupKey: 'performance', severity: 'HIGH', effort: 'MEDIUM', title: 'Improve page speed', evidence: { lcp: 10_000 } }),
  fix({ groupKey: 'cdn', severity: 'MEDIUM', effort: 'LOW', title: 'Stop Cloudflare blocking AI crawlers', evidence: { cdnVendor: 'Cloudflare', blockedBots: ['GPTBot', 'ClaudeBot', 'CCBot'] } }),
  ...brandPages,
  fix({ groupKey: 'agent-readiness', severity: 'LOW', title: 'Agent readiness: MCP' }),
]);

describe('fix brief', () => {
  it('counts every fix by impact and groups them in plan order', () => {
    const brief = buildFixBrief(sample);
    expect(brief.total).toBe(9);
    expect(brief.bySeverity).toEqual({ HIGH: 1, MEDIUM: 7, LOW: 1 });
    expect(brief.categories.map((c) => [c.label, c.count])).toEqual([
      ['Page speed', 1],
      ['AI crawler access', 1],
      ['Main headings (h1)', 6],
      ['AI agent readiness', 1],
    ]);
  });

  it('starts with the most important fix, a quick win, and a shared page template, using real evidence', () => {
    const [first, second, third] = buildFixBrief(sample).start;
    expect(first).toMatchObject({ title: 'Page speed', tag: 'High' });
    expect(first.note).toContain('10 seconds');
    expect(first.note).toContain('fix 1');
    expect(second).toMatchObject({ title: 'AI crawler access', tag: 'Quick' });
    expect(second.note).toContain('Cloudflare is refusing GPTBot, ClaudeBot and others');
    expect(third.title).toBe('The /brand/ page template');
    expect(third.note).toContain('6 of the page fixes');
  });

  it('folds long tails into one "Everything else" row so the page stays one page', () => {
    const keys = ['performance', 'cdn', 'robots', 'sitemap', 'schema', 'rendering', 'page.title', 'page.meta', 'page.h1'];
    const brief = buildFixBrief(pack(keys.map((groupKey) => fix({ groupKey }))));
    expect(brief.categories).toHaveLength(7);
    expect(brief.categories.at(-1)).toMatchObject({ label: 'Everything else', count: 3 });
  });

  it('says what is already verified instead of treating it as to-do', () => {
    const brief = buildFixBrief(pack([fix({ status: 'VERIFIED' }), fix({})]));
    expect(brief.verified).toBe(1);
    expect(renderFixBriefHtml(brief)).toContain('1 fix is already verified');
  });

  it('renders the logo, escapes project text, carries no date and no em dashes', () => {
    const html = renderFixBriefHtml(buildFixBrief({ ...sample, project: { id: 'p', name: 'A<b>&"co"', domain: 'acme.test' } }));
    expect(html).toContain('alt="Rothenhall Partners" src="data:image/png;base64,');
    expect(html).toContain('A&lt;b&gt;&amp;&quot;co&quot;');
    expect(html).not.toContain('<b>&"co"');
    expect(html).not.toMatch(/2026-09-28|Generated/);
    expect(html).not.toContain('—');
    expect(html).toContain('fix-plan-acme.test.md');
  });

  it('names downloads after the site, not an internal id', () => {
    expect(packFileName('https://Faydo.in')).toBe('fix-plan-faydo.in.md');
    expect(briefFileName('faydo.in')).toBe('fix-plan-faydo.in-overview.pdf');
  });

  it('the shared Markdown pack has no generation timestamp', () => {
    const md = renderFixPackMarkdown(sample);
    expect(md).not.toContain('Generated');
    expect(md).toContain('9 fixes, most severe first.');
  });
});
