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
  <title>{{meta.projectName}} — {{meta.kind}} Report</title>
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
    Generated by Cailyx. Sections omitted above reflect audits not yet run for this project — never a fabricated result.
  </footer>
</div>
</body>
</html>
`;
