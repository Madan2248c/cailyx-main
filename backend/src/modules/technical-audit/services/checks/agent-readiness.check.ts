/**
 * Agent-readiness check — how accessible is this site to an AI agent, per
 * `is-agentic`'s own scoring?
 *
 * Two paths, CLI first: `npx is-agentic@latest <host> --json` can *start* a
 * scan; the read-only API (`is-agentic.com/api/v1/report`) can only read
 * back a report that already exists. Genuinely careful subprocess handling —
 * `execFile` with array args, `shell: false` always, a strict hostname-only
 * regex validated before anything reaches a subprocess — ported exactly from
 * the old repo, not simplified into a naive `exec()` call.
 *
 * Runs unconditionally for any valid hostname, no same-domain gating — this
 * is confirmed policy (docs/analysis/technical-audit.md "Agent readiness"):
 * `is-agentic` publishes a report page for every domain it scans regardless
 * of who requested it, and that public-exposure trade-off has already been
 * decided, not something this check re-litigates per call.
 *
 * @module technical-audit/services/checks/agent-readiness
 */

import { execFile } from 'node:child_process';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AGENT_READINESS_API_TIMEOUT_MS, AGENT_READINESS_DEFAULT_TIMEOUT_MS } from '../../technical-audit.constants.js';
import type { AgentReadinessAnalysis, AgentReadinessIssue, AuditFinding } from '../../technical-audit.types.js';
import type { AuditContext } from '../audit-context.js';

/** Hostname-shape only — no scheme, path, port, credentials or shell metacharacters can survive this. */
const SAFE_HOST = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const PASS_SCORE_FLOOR = 70;
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;

const EMPTY_ANALYSIS: Omit<AgentReadinessAnalysis, 'source' | 'error'> = {
  score: null,
  scoreLabel: null,
  target: null,
  reportUrl: null,
  scannedAt: null,
  eligibleChecks: null,
  breakdown: null,
  issues: [],
};

/** The shape this check accepts as "a usable report" from either path — everything else is defensively coerced. */
interface RawReport {
  score?: unknown;
  score_label?: unknown;
  target?: unknown;
  report_url?: unknown;
  scanned_at?: unknown;
  eligible_checks?: unknown;
  score_breakdown?: unknown;
  issues?: unknown;
}

@Injectable()
export class AgentReadinessCheck {
  private readonly logger = new Logger(AgentReadinessCheck.name);

  constructor(private readonly config: ConfigService) {}

  async run(ctx: AuditContext): Promise<AuditFinding> {
    const host = this.extractHost(ctx.targetUrl);
    if (!host) {
      return this.finding({ ...EMPTY_ANALYSIS, source: 'none', error: 'Target URL has no valid hostname to scan.' });
    }

    const cliEnabled = this.config.get<string>('AGENT_READINESS_CLI') !== 'false';
    let report: RawReport | null = null;
    let source: AgentReadinessAnalysis['source'] = 'none';

    if (cliEnabled) {
      report = await this.runCli(host);
      if (report) source = 'cli';
    }

    if (!report) {
      report = await this.readApi(ctx.targetUrl, host);
      if (report) source = 'api';
    }

    if (!report) {
      const triedCli = cliEnabled ? 'the CLI scan and ' : '';
      return this.finding({ ...EMPTY_ANALYSIS, source: 'none', error: `Could not obtain a report. Tried ${triedCli}the read-only API, neither returned a usable score.` });
    }

    return this.finding({ ...this.mapReport(report, ctx.targetUrl), source, error: null });
  }

  // ─── CLI path ────────────────────────────────────────────────────────────

  private async runCli(host: string): Promise<RawReport | null> {
    const timeoutMs = Number(this.config.get<string>('AGENT_READINESS_TIMEOUT_MS')) || AGENT_READINESS_DEFAULT_TIMEOUT_MS;
    const args = ['--yes', 'is-agentic@latest', host, '--json'];
    const env = { ...process.env, NO_COLOR: '1', CI: '1' };

    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        const onDone = (err: Error | null, stdout: string) => (err ? reject(err) : resolve(stdout));
        // Windows: `npx` resolves to a .cmd/batch file, which Node refuses to
        // spawn without shell:true post-CVE-2024-27980. Route through the
        // Windows command shell explicitly instead — still every argument in
        // its own array slot, never string-concatenated, so this carries the
        // same injection defense as the non-Windows path.
        if (process.platform === 'win32') {
          const comSpec = process.env.ComSpec || 'cmd.exe';
          execFile(comSpec, ['/d', '/s', '/c', 'npx', ...args], { shell: false, timeout: timeoutMs, maxBuffer: MAX_STDOUT_BYTES, windowsHide: true, env }, onDone);
        } else {
          execFile('npx', args, { shell: false, timeout: timeoutMs, maxBuffer: MAX_STDOUT_BYTES, windowsHide: true, env }, onDone);
        }
      });
      return this.extractJson(stdout);
    } catch (err) {
      this.logger.debug(`is-agentic CLI scan failed for ${host}: ${(err as Error).message}`);
      return null;
    }
  }

  /** `npx` can print install chatter before the JSON payload — locate the object rather than assume clean stdout. */
  private extractJson(stdout: string): RawReport | null {
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) return null;
    try {
      const parsed = JSON.parse(stdout.slice(start, end + 1)) as unknown;
      return this.isUsableReport(parsed) ? (parsed as RawReport) : null;
    } catch {
      return null;
    }
  }

  private isUsableReport(value: unknown): boolean {
    return !!value && typeof value === 'object' && typeof (value as RawReport).score === 'number';
  }

  // ─── API path ────────────────────────────────────────────────────────────

  /** Read-only fallback — tries the exact target URL first, then the bare origin, since the API keys on the literal URL string. */
  private async readApi(targetUrl: string, host: string): Promise<RawReport | null> {
    for (const candidate of [targetUrl, `https://${host}`]) {
      const report = await this.fetchReport(candidate);
      if (report) return report;
    }
    return null;
  }

  private async fetchReport(url: string): Promise<RawReport | null> {
    try {
      const res = await fetch(`https://is-agentic.com/api/v1/report?url=${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(AGENT_READINESS_API_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const parsed = (await res.json()) as unknown;
      return this.isUsableReport(parsed) ? (parsed as RawReport) : null;
    } catch {
      return null;
    }
  }

  // ─── Mapping + finding ───────────────────────────────────────────────────

  private mapReport(report: RawReport, targetUrl: string): Omit<AgentReadinessAnalysis, 'source' | 'error'> {
    const score = typeof report.score === 'number' ? report.score : null;
    return {
      score,
      scoreLabel: typeof report.score_label === 'string' ? report.score_label : null,
      target: typeof report.target === 'string' ? report.target : targetUrl,
      reportUrl: typeof report.report_url === 'string' ? report.report_url : null,
      scannedAt: typeof report.scanned_at === 'string' ? report.scanned_at : null,
      eligibleChecks: typeof report.eligible_checks === 'number' ? report.eligible_checks : null,
      breakdown: this.mapBreakdown(report.score_breakdown),
      issues: this.mapIssues(report.issues),
    };
  }

  private mapBreakdown(raw: unknown): AgentReadinessAnalysis['breakdown'] {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const band = (key: string): { earned: number; available: number; passing: number; total: number } | undefined => {
      const b = obj[key];
      if (!b || typeof b !== 'object') return undefined;
      const v = b as Record<string, unknown>;
      const num = (x: unknown) => (typeof x === 'number' ? x : 0);
      return { earned: num(v.earned), available: num(v.available), passing: num(v.passing), total: num(v.total) };
    };
    const bonusRaw = obj.bonus;
    const bonus =
      bonusRaw && typeof bonusRaw === 'object'
        ? {
            points: typeof (bonusRaw as Record<string, unknown>).points === 'number' ? ((bonusRaw as Record<string, unknown>).points as number) : 0,
            positive_signals:
              typeof (bonusRaw as Record<string, unknown>).positive_signals === 'number' ? ((bonusRaw as Record<string, unknown>).positive_signals as number) : 0,
          }
        : undefined;
    const essential = band('essential');
    const recommended = band('recommended');
    if (!essential && !recommended && !bonus) return null;
    return { essential, recommended, bonus };
  }

  private mapIssues(raw: unknown): AgentReadinessIssue[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
      .map((i) => ({
        id: typeof i.id === 'string' ? i.id : '',
        name: typeof i.name === 'string' ? i.name : '',
        result: typeof i.result === 'string' ? i.result : '',
        recommendation: typeof i.recommendation === 'string' ? i.recommendation : '',
        details: typeof i.details === 'string' ? i.details : undefined,
      }));
  }

  private finding(analysis: AgentReadinessAnalysis): AuditFinding {
    const notRun = analysis.source === 'none';
    const passing = analysis.score !== null && analysis.score >= PASS_SCORE_FLOOR;

    return {
      type: 'agent-readiness',
      status: notRun ? 'not-run' : passing ? 'pass' : 'fail',
      severity: notRun || passing ? 'low' : 'medium',
      // A third-party tool's own scan, not something this codebase directly
      // confirmed against the site — inferred, same reasoning as the CDN check.
      confidence: 'inferred',
      recommendedFix: this.recommendedFix(analysis, notRun, passing),
      detail: { ...analysis },
    };
  }

  private recommendedFix(analysis: AgentReadinessAnalysis, notRun: boolean, passing: boolean): string {
    if (notRun) {
      return analysis.error ?? 'Agent-readiness scan could not be completed this run.';
    }
    if (passing) {
      return `Agent readiness score ${analysis.score}/100${analysis.scoreLabel ? ` (${analysis.scoreLabel})` : ''}. The site is broadly accessible to AI agents.`;
    }
    const topIssues = analysis.issues.slice(0, 3).map((i) => i.name || i.id).filter(Boolean);
    const issueText = topIssues.length > 0 ? ` Top issues: ${topIssues.join(', ')}.` : '';
    return `Agent readiness score ${analysis.score}/100${analysis.scoreLabel ? ` (${analysis.scoreLabel})` : ''}, below the ${PASS_SCORE_FLOOR} floor.${issueText} See the full report${analysis.reportUrl ? ` at ${analysis.reportUrl}` : ''} for details.`;
  }

  private extractHost(targetUrl: string): string | null {
    try {
      const host = new URL(targetUrl).hostname;
      return SAFE_HOST.test(host) ? host : null;
    } catch {
      return null;
    }
  }
}
