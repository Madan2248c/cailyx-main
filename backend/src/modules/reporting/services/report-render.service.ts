/**
 * HTML render — compiles the section + document Handlebars templates once
 * (registered partials shared across every render), builds each section's
 * view-model in TypeScript (percentages, badge classes, kpi arrays — the
 * templates themselves stay dumb and data-driven), and produces the final
 * HTML string. No PDF here — HTML render only, per the analysis doc's
 * explicit scope for this pass.
 *
 * @module reporting/services/report-render.service
 */

import { Injectable } from '@nestjs/common';
import Handlebars from 'handlebars';
import { DOCUMENT_TEMPLATE, PARTIALS, STYLE } from '../templates/report.template.js';
import { SECTION_TEMPLATES } from '../templates/sections.template.js';
import type { ReportContent, ReportDelta } from '../reporting.types.js';

let registered = false;
const compiledDocument = Handlebars.compile(DOCUMENT_TEMPLATE);
const compiledSections: Record<string, HandlebarsTemplateDelegate> = {};

function ensureRegistered(): void {
  if (registered) return;
  Handlebars.registerPartial('kpiRow', PARTIALS.kpiRow);
  Handlebars.registerPartial('dimRow', PARTIALS.dimRow);
  Handlebars.registerPartial('barList', PARTIALS.barList);
  for (const [key, tpl] of Object.entries(SECTION_TEMPLATES)) {
    compiledSections[key] = Handlebars.compile(tpl);
  }
  registered = true;
}

function statusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s === 'fail' || s === 'error' || s === 'high') return 'badge b-high';
  if (s === 'warn' || s === 'medium' || s === 'not-run') return 'badge b-medium';
  if (s === 'pass' || s === 'low') return 'badge b-strength';
  return 'badge b-low';
}

function severityBadgeClass(severity: string): string {
  const s = severity.toLowerCase();
  if (s === 'high' || s === 'critical') return 'badge b-high';
  if (s === 'medium' || s === 'warn') return 'badge b-medium';
  return 'badge b-low';
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

@Injectable()
export class ReportRenderService {
  render(content: ReportContent): string {
    ensureRegistered();

    const sections = content.sectionOrder
      .map((key, i) => {
        const html = this.renderSection(key, content, i + 1);
        return html ? { html } : null;
      })
      .filter((s): s is { html: string } => s !== null);

    return compiledDocument({ meta: content.meta, executiveSummary: content.executiveSummary, sections, style: STYLE });
  }

  private renderSection(key: string, content: ReportContent, index: number): string | null {
    const numeral = String(index).padStart(2, '0');
    const template = compiledSections[key];
    if (!template) return null;

    switch (key) {
      case 'technicalAudit': {
        const s = content.technicalAudit;
        if (!s) return null;
        return template({
          numeral,
          hasScore: s.score != null,
          kpis: s.score != null ? [{ label: 'Composite score', value: `${s.score}/100`, emph: true }] : [],
          findings: s.findings.map((f) => ({ ...f, statusBadge: statusBadgeClass(f.status), severityBadge: severityBadgeClass(f.severity) })),
          narrative: s.narrative,
        });
      }
      case 'socialActivity': {
        const s = content.socialActivity;
        if (!s) return null;
        return template({
          numeral,
          platforms: s.platforms.map((p) => ({ ...p, followerCount: p.followerCount ?? 'n/a' })),
          findings: s.findings.map((f) => ({ ...f, severityBadge: severityBadgeClass(f.severity) })),
        });
      }
      case 'aeoAudit': {
        const s = content.aeoAudit;
        if (!s) return null;
        const maxStanding = Math.max(1, ...s.competitorStanding.map((c) => c.timesBehind + c.timesAhead + c.coMentions));
        return template({
          numeral,
          kpis: [
            { label: 'Mention rate', value: pct(s.overallMentionRate), emph: true },
            { label: 'Citation rate', value: pct(s.overallCitationRate) },
          ],
          headlines: s.headlines,
          competitorRows: s.competitorStanding.map((c) => ({
            label: c.name,
            value: `${c.timesBehind} behind`,
            percent: Math.round(((c.timesBehind + c.timesAhead + c.coMentions) / maxStanding) * 100),
          })),
          narrative: s.narrative,
        });
      }
      case 'competitors': {
        const s = content.competitors;
        if (!s) return null;
        return template({
          numeral,
          ownSeoScore: s.own.seoScore != null ? `${s.own.seoScore}/100` : 'n/a',
          rows: s.rows.map((r) => ({
            name: r.name,
            domain: r.domain ?? 'n/a',
            seoScoreLabel: r.seoScore != null ? `${r.seoScore}/100` : 'n/a',
            reviewLabel: r.reviewRating ? `${r.reviewRating.rating}/5 (${r.reviewRating.source})` : 'n/a',
            aeoLabel: r.aeoStanding ? `${r.aeoStanding.timesBehind} behind, ${r.aeoStanding.timesAhead} ahead` : 'n/a',
          })),
        });
      }
      case 'gapAnalysis': {
        const s = content.gapAnalysis;
        if (!s) return null;
        return template({
          numeral,
          recommendations: s.recommendations.map((r) => ({ ...r, statusBadge: r.status === 'DONE' ? 'badge b-strength' : r.status === 'DISMISSED' ? 'badge b-low' : 'badge b-medium' })),
        });
      }
      case 'deltas': {
        const deltas = content.deltas;
        if (!deltas || deltas.length === 0) return null;
        return template({ numeral, kpis: deltas.map((d) => this.deltaKpi(d)) });
      }
      default:
        return null;
    }
  }

  private deltaKpi(d: ReportDelta): { label: string; value: string; emph: boolean } {
    const prev = typeof d.previous === 'number' ? d.previous : null;
    const cur = typeof d.current === 'number' ? d.current : null;
    const label = `${d.module} · ${d.metric}`;
    if (prev == null || cur == null) return { label, value: `${d.current ?? 'n/a'}`, emph: false };
    const arrow = cur > prev ? '↑' : cur < prev ? '↓' : '→';
    return { label, value: `${prev} ${arrow} ${cur}`, emph: cur < prev };
  }
}
