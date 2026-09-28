/**
 * HTML render — compiles the section + document Handlebars templates once
 * (registered partials shared across every render), builds each section's
 * view-model in TypeScript (percentages, badge classes, kpi arrays — the
 * templates themselves stay dumb and data-driven), and produces the final
 * HTML string. `renderPrint` produces the print variant (dark cover,
 * numbered sections) that the PDF route hands to the shared Playwright
 * printer (`BrowserClientService.printPdf`, the Fix Plan PDF's mechanism).
 *
 * @module reporting/services/report-render.service
 */

import { Injectable } from '@nestjs/common';
import Handlebars from 'handlebars';
import { DOCUMENT_TEMPLATE, PARTIALS, PRINT_DOCUMENT_TEMPLATE, PRINT_STYLE, STYLE } from '../templates/report.template.js';
import { SECTION_TEMPLATES } from '../templates/sections.template.js';
import { REPORT_BRAND_NAME } from '../reporting.constants.js';
import type { ReportContent, ReportDelta } from '../reporting.types.js';

let registered = false;
const compiledDocument = Handlebars.compile(DOCUMENT_TEMPLATE);
const compiledPrintDocument = Handlebars.compile(PRINT_DOCUMENT_TEMPLATE);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `2026-09-22T…` → "22 September 2026", in UTC so every server prints the same date. */
function longDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The summary's first sentence, cut at a word if long — a cover preview; the full text opens page two. */
function firstSentence(text: string): string {
  const first = text.trim().split(/(?<=[.!?])\s+/)[0] ?? '';
  return first.length <= 200 ? first : `${first.slice(0, 200).replace(/\s+\S*$/, '')}…`;
}
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

  /**
   * The print document behind "Download report": the same sections and
   * view-models as {@link render}, laid out as the Day-1 diagnostic PDF — a
   * dark cover, `01 Executive Summary` with headline tiles, then the present
   * sections numbered from `02` with no gaps. Every figure is read from
   * `content`; the cover's date is the report's own (released, else
   * created), never "now".
   */
  renderPrint(content: ReportContent, dates: { createdAt: Date | string; releasedAt?: Date | string | null }): string {
    ensureRegistered();

    const sections: Array<{ html: string }> = [];
    let next = 2;
    for (const key of content.sectionOrder) {
      const html = this.renderSection(key, content, next);
      if (html) {
        sections.push({ html });
        next += 1;
      }
    }

    const tech = content.technicalAudit;
    const aeo = content.aeoAudit;
    const isDay1 = content.meta.kind === 'DAY1';
    const kindLabel = isDay1 ? 'Day 1 diagnostic' : 'Monthly report';
    const preparedLong = longDate(dates.releasedAt ?? dates.createdAt);

    const summaryKpis: Array<{ label: string; value: string }> = [];
    if (tech?.score != null) summaryKpis.push({ label: 'Technical score (of 100)', value: String(tech.score) });
    if (aeo) summaryKpis.push({ label: 'AI mention rate', value: pct(aeo.overallMentionRate) });
    if (tech) {
      const failing = tech.findings.filter((f) => ['fail', 'error'].includes(f.status.toLowerCase())).length;
      summaryKpis.push({ label: failing === 1 ? 'Failing technical check' : 'Failing technical checks', value: String(failing) });
    }
    if (content.gapAnalysis) {
      const open = content.gapAnalysis.recommendations.filter((r) => r.status !== 'DONE' && r.status !== 'DISMISSED').length;
      summaryKpis.push({ label: open === 1 ? 'Open recommendation' : 'Open recommendations', value: String(open) });
    }

    return compiledPrintDocument({
      meta: content.meta,
      kindLabel,
      orgName: REPORT_BRAND_NAME,
      headlineAccent: isDay1 ? 'Day One.' : 'This Month.',
      lede: content.executiveSummary ? firstSentence(content.executiveSummary) : '',
      coverMeta: [
        { label: 'Website', value: content.meta.domain },
        { label: 'Report', value: kindLabel },
        { label: 'Prepared', value: preparedLong },
        { label: 'Prepared by', value: REPORT_BRAND_NAME },
      ],
      coverScore: tech?.score != null ? String(tech.score) : aeo ? pct(aeo.overallMentionRate) : '',
      coverScoreCaption: tech?.score != null ? 'Technical site score out of 100' : 'AI answer mention rate',
      preparedLong,
      summaryParagraphs: content.executiveSummary.split(/\n+/).map((p) => p.trim()).filter(Boolean),
      summaryKpis: summaryKpis.slice(0, 4),
      sections,
      style: STYLE + PRINT_STYLE,
    });
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
