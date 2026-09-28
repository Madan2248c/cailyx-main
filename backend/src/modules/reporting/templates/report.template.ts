/**
 * The report HTML template — real Handlebars, not raw-HTML-per-report.
 * Design tokens and component vocabulary ported from
 * `docs/day1-report-pdf-style-guide.md` (obsidian/linen/terracotta,
 * Jost/Instrument Sans/Fraunces-italic) — explicitly NOT that system's
 * Playwright+pdfunite mechanism, which the analysis doc confirms was a
 * one-off styling exercise with zero reuse value. Stored as a TS string
 * constant rather than a loose `.hbs` file: this repo's build has no
 * asset-copy step (`nest-cli.json` has none), so a file on disk would
 * need new build wiring for zero benefit over a template literal.
 *
 * @module reporting/templates/report.template
 */

export const STYLE = `
  :root {
    --obsidian: #14120D;
    --linen: #F7F3EA;
    --white: #FFFFFF;
    --terracotta: #B8703F;
    --ink-70: rgba(20,18,13,0.70);
    --ink-45: rgba(20,18,13,0.45);
    --ink-15: rgba(20,18,13,0.15);
    --ink-08: rgba(20,18,13,0.08);
    --font-label: "Jost", ui-sans-serif, system-ui, sans-serif;
    --font-body: "Instrument Sans", ui-sans-serif, system-ui, sans-serif;
    --font-display: "Fraunces", serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--linen); color: var(--obsidian); font-family: var(--font-body); line-height: 1.6; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 40px 24px; }
  .label { font-family: var(--font-label); text-transform: uppercase; letter-spacing: 0.14em; font-size: 12px; color: var(--ink-70); }
  header { border-bottom: 2px solid var(--terracotta); padding-bottom: 16px; margin-bottom: 32px; }
  header .eyebrow { font-family: var(--font-label); text-transform: uppercase; letter-spacing: 0.14em; font-size: 12px; color: var(--terracotta); margin: 0 0 6px; }
  h1 { font-size: 28px; margin: 0 0 4px; font-weight: 500; }
  .domain { color: var(--ink-45); font-size: 14px; }
  .exec-summary { font-size: 16px; background: var(--white); border: 1px solid var(--ink-15); border-radius: 8px; padding: 20px 24px; margin-bottom: 28px; }
  h2 { font-family: var(--font-label); text-transform: uppercase; letter-spacing: 0.08em; font-size: 16px; border-bottom: 1px solid var(--ink-15); padding-bottom: 8px; margin: 36px 0 16px; }
  h2 .numeral { font-family: var(--font-display); font-style: italic; color: var(--terracotta); font-size: 20px; margin-right: 8px; }

  .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .kpi { background: var(--white); border: 1px solid var(--ink-15); border-radius: 8px; padding: 14px 16px; }
  .kpi .label { display: block; margin-bottom: 6px; }
  .kpi .value { font-family: var(--font-display); font-style: italic; font-size: 30px; color: var(--obsidian); }
  .kpi.emph { background: var(--obsidian); color: var(--linen); }
  .kpi.emph .value { color: var(--terracotta); }
  .kpi.emph .label { color: var(--ink-70); }

  .dimrow { margin-bottom: 14px; }
  .dimrow .head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
  .dimrow .name { font-weight: 600; }
  .dimrow .score { font-family: var(--font-display); font-style: italic; color: var(--terracotta); }
  .dimrow .track { height: 8px; background: var(--ink-08); border-radius: 4px; overflow: hidden; }
  .dimrow .fill { height: 100%; background: var(--terracotta); }
  .dimrow .evidence { font-size: 13px; color: var(--ink-45); margin-top: 4px; }

  .barlist .bar-row { display: grid; grid-template-columns: minmax(120px, 200px) 1fr 60px; align-items: center; gap: 10px; margin-bottom: 6px; }
  .barlist .bar-label { font-size: 13px; }
  .barlist .bar-track { height: 10px; background: var(--ink-08); border-radius: 5px; }
  .barlist .bar-fill { height: 100%; background: var(--terracotta); border-radius: 5px; }
  .barlist .bar-value { font-size: 13px; text-align: right; font-variant-numeric: tabular-nums; }

  .badge { display: inline-block; font-family: var(--font-label); text-transform: uppercase; letter-spacing: 0.06em; font-size: 11px; padding: 2px 10px; border-radius: 10px; }
  .b-high { background: var(--obsidian); color: var(--linen); }
  .b-medium { border: 1px solid var(--obsidian); color: var(--obsidian); }
  .b-low { color: var(--ink-45); border: 1px solid var(--ink-15); }
  .b-strength { background: var(--linen); border: 1px solid var(--terracotta); color: var(--terracotta); }
  .b-opportunity { border: 1px dashed var(--terracotta); color: var(--terracotta); }

  blockquote { background: var(--white); border-left: 3px solid var(--terracotta); border-radius: 0 4px 4px 0; padding: 12px 16px; margin: 12px 0; font-style: italic; }
  .quote-src { font-family: var(--font-label); text-transform: uppercase; letter-spacing: 0.06em; font-size: 11px; color: var(--ink-45); margin-top: 6px; font-style: normal; }

  .callout { border: 1px solid var(--ink-15); border-radius: 6px; padding: 12px 16px; margin: 12px 0; background: var(--white); }
  .callout .label { display: block; margin-bottom: 6px; }

  table { width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 12px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--ink-15); vertical-align: top; }
  th { font-family: var(--font-label); text-transform: uppercase; letter-spacing: 0.06em; font-size: 11px; color: var(--ink-45); }
  .note { font-size: 13px; color: var(--ink-45); }
  footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--ink-15); font-size: 12px; color: var(--ink-45); }
`;

export const PARTIALS = {
  kpiRow: `
    <div class="kpi-row">
      {{#each items}}
      <div class="kpi{{#if emph}} emph{{/if}}">
        <span class="label">{{label}}</span>
        <span class="value">{{value}}</span>
      </div>
      {{/each}}
    </div>`,
  dimRow: `
    <div class="dimrow">
      <div class="head"><span class="name">{{name}}</span><span class="score">{{score}}</span></div>
      <div class="track"><div class="fill" style="width:{{percent}}%"></div></div>
      {{#if evidence}}<div class="evidence">{{evidence}}</div>{{/if}}
    </div>`,
  barList: `
    <div class="barlist">
      {{#each rows}}
      <div class="bar-row">
        <span class="bar-label">{{label}}</span>
        <div class="bar-track"><div class="bar-fill" style="width:{{percent}}%"></div></div>
        <span class="bar-value">{{value}}</span>
      </div>
      {{/each}}
    </div>`,
};

export const DOCUMENT_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{meta.projectName}}: {{meta.kind}} Report</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700&family=Instrument+Sans:wght@400..700&family=Fraunces:ital,opsz,wght@1,9..144,500;1,9..144,600&display=swap" rel="stylesheet">
  <style>{{{style}}}</style>
</head>
<body>
<div class="wrap">
  <header>
    <p class="eyebrow">{{meta.kind}} Report</p>
    <h1>{{meta.projectName}}</h1>
    <div class="domain">{{meta.domain}} · Generated {{meta.generatedAt}}</div>
  </header>

  <div class="exec-summary">{{executiveSummary}}</div>

  {{#each sections}}
    {{{this.html}}}
  {{/each}}

  <footer>
    Generated by Cailyx. Sections omitted above reflect audits not yet run for this project, never a fabricated result.
  </footer>
</div>
</body>
</html>
`;

/**
 * Print overrides for the downloadable PDF, layered on top of `STYLE`.
 * Mirrors the approved Day-1 diagnostic (the Faydo PDF): a full-bleed dark
 * cover page, then A4 content pages with an italic Fraunces numeral + Jost
 * title over an ink rule, linen KPI tiles with terracotta italic figures,
 * rectangular severity badges and linen pull-quotes. The cover uses a named
 * `@page` with zero margin so its background runs to the edge.
 */
export const PRINT_STYLE = `
  @page { size: A4; margin: 18mm 16mm 16mm; }
  @page cover { margin: 0; }
  html, body { background: var(--white); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-size: 12.5px; color: rgba(20,18,13,0.82); }
  .wrap { max-width: none; padding: 0; }

  .cover { page: cover; break-after: page; position: relative; width: 210mm; height: 297mm; overflow: hidden;
    color: #F2EDE2; background: radial-gradient(ellipse 70% 45% at 50% 34%, #3B2A17 0%, rgba(20,18,14,0) 70%), #14120E; }
  .cover .top { position: absolute; top: 20mm; left: 20mm; right: 20mm; display: flex; justify-content: space-between; }
  .cover .top span, .cover .meta-label { font-family: var(--font-label); text-transform: uppercase; letter-spacing: 0.3em; font-size: 9px; color: rgba(242,237,226,0.55); }
  .cover .lockup { position: absolute; top: 74mm; left: 0; right: 0; display: flex; justify-content: center; align-items: center; gap: 30px; }
  .cover .org { font-family: var(--font-display); font-size: 21px; letter-spacing: 0.16em; text-transform: uppercase; }
  .cover .times { font-family: var(--font-label); font-size: 15px; color: rgba(242,237,226,0.55); }
  .cover .client { background: #F2EDE2; color: var(--obsidian); border-radius: 12px; padding: 14px 24px; font-family: var(--font-display); font-size: 24px; }
  .cover .main { position: absolute; top: 134mm; left: 30mm; right: 30mm; text-align: center; }
  .cover .eyebrow { font-family: var(--font-label); text-transform: uppercase; letter-spacing: 0.3em; font-size: 10px; color: var(--terracotta); margin: 0 0 18px; }
  .cover h1 { font-family: var(--font-display); font-weight: 500; font-size: 46px; line-height: 1.1; margin: 0; color: #F2EDE2; }
  .cover h1 em { display: block; font-style: italic; font-weight: 600; color: var(--terracotta); }
  .cover .lede { font-size: 13px; line-height: 1.65; color: rgba(242,237,226,0.62); max-width: 118mm; margin: 18px auto 0; }
  .cover .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 0; width: 120mm; margin: 30px auto 0; padding-top: 20px; border-top: 1px solid rgba(242,237,226,0.18); }
  .cover .grid div { display: flex; flex-direction: column; gap: 4px; }
  .cover .meta-label { font-size: 8px; letter-spacing: 0.2em; }
  .cover .meta-value { font-size: 12.5px; font-weight: 500; color: #F2EDE2; }
  .cover .bottom { position: absolute; bottom: 20mm; left: 20mm; right: 20mm; display: flex; justify-content: space-between; align-items: flex-end; }
  .cover .score { font-family: var(--font-display); font-style: italic; font-weight: 600; font-size: 68px; line-height: 1; color: var(--terracotta); }
  .cover .score-cap { font-size: 10px; color: rgba(242,237,226,0.55); max-width: 64mm; margin-top: 6px; }
  .cover .sign { text-align: right; font-family: var(--font-display); font-size: 14px; }
  .cover .sign em { font-style: italic; font-weight: 600; color: var(--terracotta); }
  .cover .sign small { display: block; font-family: var(--font-body); font-size: 10px; color: rgba(242,237,226,0.55); margin-top: 4px; }

  header { display: none; }
  h2 { font-family: var(--font-label); text-transform: none; letter-spacing: 0; font-weight: 500; font-size: 21px; color: var(--obsidian);
    border-bottom: 1.2px solid var(--obsidian); padding-bottom: 12px; margin: 34px 0 18px; break-after: avoid; }
  h2 .numeral { font-size: 24px; margin-right: 10px; }
  h3 { font-family: var(--font-label); font-weight: 500; font-size: 15px; color: var(--obsidian); margin: 20px 0 10px; break-after: avoid; }
  .page-lead h2 { margin-top: 0; }
  .exec-summary { background: none; border: 0; border-radius: 0; padding: 0; font-size: 13px; line-height: 1.7; margin-bottom: 18px; }
  .exec-summary p { margin: 0 0 10px; }

  .kpi-row { grid-template-columns: repeat(4, 1fr); gap: 10px; break-inside: avoid; }
  .kpi, .kpi.emph { background: #F5F0E6; color: var(--obsidian); border: 1px solid rgba(20,18,13,0.12); border-radius: 0; padding: 16px 16px 14px; display: flex; flex-direction: column-reverse; justify-content: flex-end; gap: 10px; }
  .kpi .label, .kpi.emph .label { margin: 0; font-size: 9px; letter-spacing: 0.14em; color: rgba(20,18,13,0.6); }
  .kpi .value, .kpi.emph .value { font-size: 30px; font-weight: 600; line-height: 1; color: var(--terracotta); }

  table { font-size: 12px; break-inside: auto; }
  tr { break-inside: avoid; }
  th { font-family: var(--font-label); font-weight: 500; font-size: 9px; letter-spacing: 0.12em; color: rgba(20,18,13,0.45); border-bottom: 1.2px solid var(--obsidian); }
  td { padding: 10px; border-bottom: 1px solid rgba(20,18,13,0.1); }

  .badge { border-radius: 2px; font-weight: 600; font-size: 9px; letter-spacing: 0.1em; padding: 4px 9px; }
  .b-high { background: var(--obsidian); color: #F2EDE2; }
  .b-strength { background: #F5F0E6; border: 1px solid rgba(20,18,13,0.14); color: var(--obsidian); }
  .b-opportunity { border: 1px dashed rgba(20,18,13,0.35); color: rgba(20,18,13,0.6); }

  blockquote { background: #F5F0E6; border-left: 3px solid var(--terracotta); border-radius: 0; padding: 14px 18px; font-family: var(--font-display); font-style: italic; font-weight: 600; color: var(--obsidian); break-inside: avoid; }
  .callout { background: #F5F0E6; border: 0; border-left: 3px solid var(--terracotta); border-radius: 0; break-inside: avoid; }
  .barlist .bar-row { grid-template-columns: 150px 1fr 90px; }
  .barlist .bar-track { border-radius: 0; background: #ECE7DD; }
  .barlist .bar-fill { border-radius: 0; }
  .barlist .bar-value { font-weight: 600; color: var(--obsidian); }
  .dimrow { break-inside: avoid; }
  footer { font-family: var(--font-label); font-size: 9px; }
`;

/** The PDF document: dark cover, then `01 Executive Summary`, then the numbered sections. */
export const PRINT_DOCUMENT_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{{meta.projectName}}: {{kindLabel}}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700&family=Instrument+Sans:wght@400..700&family=Fraunces:ital,opsz,wght@0,9..144,500;1,9..144,500;1,9..144,600&display=swap" rel="stylesheet">
  <style>{{{style}}}</style>
</head>
<body>
<section class="cover">
  <div class="top"><span>{{kindLabel}}</span><span>{{orgName}}</span></div>
  <div class="lockup">
    <span class="org">{{orgName}}</span>
    <span class="times">&times;</span>
    <span class="client">{{meta.domain}}</span>
  </div>
  <div class="main">
    <p class="eyebrow">AEO audit &mdash; {{meta.domain}}</p>
    <h1>AI Visibility,<em>{{headlineAccent}}</em></h1>
    {{#if lede}}<p class="lede">{{lede}}</p>{{/if}}
    <div class="grid">
      {{#each coverMeta}}<div><span class="meta-label">{{label}}</span><span class="meta-value">{{value}}</span></div>{{/each}}
    </div>
  </div>
  <div class="bottom">
    <div>
      {{#if coverScore}}<div class="score">{{coverScore}}</div><div class="score-cap">{{coverScoreCaption}}</div>{{/if}}
    </div>
    <div class="sign">{{orgName}}<small>{{preparedLong}}</small></div>
  </div>
</section>

<div class="wrap">
  <div class="page-lead">
    <h2><span class="numeral">01</span>Executive Summary</h2>
    <div class="exec-summary">{{#each summaryParagraphs}}<p>{{this}}</p>{{/each}}</div>
    {{#if summaryKpis.length}}{{> kpiRow items=summaryKpis}}{{/if}}
  </div>

  {{#each sections}}
    {{{this.html}}}
  {{/each}}

  <footer>
    {{orgName}} &mdash; {{kindLabel}} for {{meta.domain}}, prepared {{preparedLong}}. Compiled from stored audit data; sections omitted reflect audits not yet run for this project, never a fabricated result.
  </footer>
</div>
</body>
</html>
`;
