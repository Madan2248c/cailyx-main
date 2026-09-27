/**
 * One Handlebars template per section kind. Each takes an already-computed
 * view-model (percentages, badge classes, kpi arrays built in TypeScript,
 * never in the template) — keeps the templates dumb and data-driven.
 *
 * @module reporting/templates/sections.template
 */

export const SECTION_TEMPLATES: Record<string, string> = {
  technicalAudit: `
    <h2><span class="numeral">{{numeral}}</span>Technical Audit</h2>
    {{#if hasScore}}{{> kpiRow items=kpis}}{{/if}}
    {{#if findings.length}}
    <table>
      <thead><tr><th>Check</th><th>Status</th><th>Severity</th></tr></thead>
      <tbody>
      {{#each findings}}
      <tr>
        <td>{{type}}<div class="note">{{recommendedFix}}</div></td>
        <td><span class="badge {{statusBadge}}">{{status}}</span></td>
        <td><span class="badge {{severityBadge}}">{{severity}}</span></td>
      </tr>
      {{/each}}
      </tbody>
    </table>
    {{/if}}
    {{#if narrative}}<div class="callout"><span class="label">Commentary</span>{{narrative}}</div>{{/if}}
  `,

  socialActivity: `
    <h2><span class="numeral">{{numeral}}</span>Social Activity</h2>
    {{#if platforms.length}}
    <table>
      <thead><tr><th>Platform</th><th>Pattern</th><th>Posts in window</th><th>Followers</th></tr></thead>
      <tbody>
      {{#each platforms}}
      <tr><td>{{platform}}</td><td>{{pattern}}</td><td>{{postsInWindow}}</td><td>{{followerCount}}</td></tr>
      {{/each}}
      </tbody>
    </table>
    {{/if}}
    {{#if findings.length}}
    <table>
      <thead><tr><th>Platform</th><th>Finding</th><th>Severity</th></tr></thead>
      <tbody>
      {{#each findings}}
      <tr><td>{{platform}}</td><td>{{detail}}</td><td><span class="badge {{severityBadge}}">{{severity}}</span></td></tr>
      {{/each}}
      </tbody>
    </table>
    {{/if}}
  `,

  aeoAudit: `
    <h2><span class="numeral">{{numeral}}</span>AI Visibility (AEO)</h2>
    {{> kpiRow items=kpis}}
    {{#if headlines.length}}
    <ul>{{#each headlines}}<li>{{this}}</li>{{/each}}</ul>
    {{/if}}
    {{#if competitorRows.length}}
    <h3>Competitor standing</h3>
    {{> barList rows=competitorRows}}
    {{/if}}
    {{#if narrative}}
    {{#each narrative}}<blockquote>{{this}}</blockquote>{{/each}}
    {{/if}}
  `,

  competitors: `
    <h2><span class="numeral">{{numeral}}</span>Competitor Landscape</h2>
    <p class="note">Your homepage SEO score: <strong>{{ownSeoScore}}</strong></p>
    {{#if rows.length}}
    <table>
      <thead><tr><th>Competitor</th><th>SEO score</th><th>Review rating</th><th>AEO standing</th></tr></thead>
      <tbody>
      {{#each rows}}
      <tr>
        <td>{{name}}<div class="note">{{domain}}</div></td>
        <td>{{seoScoreLabel}}</td>
        <td>{{reviewLabel}}</td>
        <td>{{aeoLabel}}</td>
      </tr>
      {{/each}}
      </tbody>
    </table>
    {{/if}}
  `,

  gapAnalysis: `
    <h2><span class="numeral">{{numeral}}</span>What To Do Now</h2>
    {{#if recommendations.length}}
    <table>
      <thead><tr><th>Priority</th><th>Recommendation</th><th>Status</th></tr></thead>
      <tbody>
      {{#each recommendations}}
      <tr>
        <td>{{rank}}</td>
        <td><strong>{{title}}</strong><div class="note">{{description}}</div></td>
        <td><span class="badge {{statusBadge}}">{{status}}</span></td>
      </tr>
      {{/each}}
      </tbody>
    </table>
    {{/if}}
  `,

  deltas: `
    <h2><span class="numeral">{{numeral}}</span>Since Your Last Report</h2>
    {{> kpiRow items=kpis}}
  `,
};
