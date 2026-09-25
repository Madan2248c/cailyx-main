/**
 * CDN/WAF blocking check — does the CDN silently block AI bots that
 * robots.txt allows?
 *
 * Distinct from the robots check on purpose: a site's robots.txt can say
 * "allowed" while a CDN or WAF's bot-management rules return 403 anyway —
 * that mismatch (`silentBlockDetected`) is what this check exists to catch,
 * not "is any bot blocked at all."
 *
 * Ported verbatim from the old repo's `technical-audit.service.ts`
 * `checkCdnBlocking`/`detectCdnVendor`/`getCdnHeaderSignals`, including the
 * exact probe roster, concurrency, and retry parameters — all load-bearing
 * and already shared, single-source-of-truth constants in
 * `fetcher/fetcher.constants.ts` (`ALL_PROBEABLE_BOTS`, `BROWSER_CONTROL`).
 *
 * @module technical-audit/services/checks/cdn
 */

import { Injectable } from '@nestjs/common';
import { ALL_PROBEABLE_BOTS } from '../../../fetcher/fetcher.constants.js';
import { FetcherService } from '../../../fetcher/fetcher.service.js';
import type { CdnAnalysis, CdnProbeResult, AuditFinding, BlockLayer } from '../../technical-audit.types.js';
import type { AuditContext } from '../audit-context.js';

/** Max concurrent probes — the fetcher's own rate limiter still applies on top of this. */
const PROBE_CONCURRENCY = 5;
/** Header keys checked for vendor detection and reported as `detectedFromHeaders`, case-insensitive. */
const SIGNAL_HEADERS = ['server', 'cf-ray', 'via', 'x-served-by', 'x-amz-cf-id', 'x-cache', 'x-cdn'];
const SEARCH_BOT_NAMES = new Set(ALL_PROBEABLE_BOTS.filter((b) => b.category === 'search').map((b) => b.name));

@Injectable()
export class CdnCheck {
  constructor(private readonly fetcher: FetcherService) {}

  async run(ctx: AuditContext): Promise<AuditFinding> {
    const control = await this.fetcher.fetch({ url: ctx.targetUrl, bypassCache: true, cacheTtlSeconds: 0 }, 'technical-audit', ctx.runId);
    const cdnVendor = this.detectCdnVendor(control.headers);
    const detectedFromHeaders = this.headerSignals(control.headers);

    const probes: CdnProbeResult[] = [];
    for (let i = 0; i < ALL_PROBEABLE_BOTS.length; i += PROBE_CONCURRENCY) {
      const batch = ALL_PROBEABLE_BOTS.slice(i, i + PROBE_CONCURRENCY);
      const results = await Promise.all(
        batch.map((bot) =>
          this.fetcher.probe(
            { url: ctx.targetUrl, userAgent: bot.userAgent, botName: bot.name, repeat: 3, retries: 1 },
            'technical-audit',
            ctx.runId,
          ),
        ),
      );
      for (const [idx, result] of results.entries()) {
        probes.push({
          botName: batch[idx]!.name,
          category: batch[idx]!.category,
          status: result.status,
          blocked: result.blocked,
          latencyMs: result.latencyMs,
          inconsistent: result.inconsistent,
          layer: 'cdn-waf' satisfies BlockLayer,
        });
      }
    }

    // A bot only counts as silently blocked if the browser control itself
    // succeeded — this detects inconsistent treatment (bot blocked while a
    // plain browser isn't), not just "this bot got a non-2xx."
    const browserOk = control.status >= 200 && control.status < 400;
    const blockedBots = browserOk ? probes.filter((p) => p.blocked).map((p) => p.botName) : [];
    const silentBlockDetected = blockedBots.length > 0 && browserOk;
    const blockedSearch = blockedBots.filter((name) => SEARCH_BOT_NAMES.has(name));

    const analysis: CdnAnalysis = {
      cdnVendor,
      detectedFromHeaders,
      probes,
      browserControlStatus: control.status,
      silentBlockDetected,
      blockedBots,
    };

    return {
      type: 'cdn-inferred',
      status: silentBlockDetected ? 'fail' : 'pass',
      severity: blockedSearch.length > 0 ? 'high' : blockedBots.length > 0 ? 'medium' : 'low',
      // Inferred, not confirmed — a probe's blocked/inconsistent verdict is a
      // statistical read of repeated attempts, not a direct confirmation from
      // the CDN vendor itself (contrast with the robots check's `confirmed`,
      // which reads a file the site published outright).
      confidence: 'inferred',
      recommendedFix: this.recommendedFix(silentBlockDetected, cdnVendor, blockedSearch, blockedBots),
      detail: { ...analysis, layer: 'cdn-waf' satisfies BlockLayer, blockedSearch, probeCount: probes.length },
    };
  }

  private detectCdnVendor(headers: Record<string, string>): string | null {
    const server = (headers['server'] ?? '').toLowerCase();
    const via = (headers['via'] ?? '').toLowerCase();
    if (headers['cf-ray']) return 'Cloudflare';
    if (headers['x-amz-cf-id']) return 'AWS CloudFront';
    if (server.includes('cloudfront')) return 'AWS CloudFront';
    if (server.includes('akamai') || via.includes('akamai')) return 'Akamai';
    if (server.includes('varnish') || via.includes('varnish')) return 'Varnish/Fastly';
    if ((headers['x-served-by'] ?? '').toLowerCase().includes('cache-') || via.includes('fastly')) return 'Fastly';
    if (server.includes('nginx')) return 'Nginx';
    return null;
  }

  private headerSignals(headers: Record<string, string>): string[] {
    const out: string[] = [];
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    for (const key of SIGNAL_HEADERS) {
      if (lower[key]) out.push(`${key}: ${lower[key]}`);
    }
    return out;
  }

  private recommendedFix(silentBlockDetected: boolean, cdnVendor: string | null, blockedSearch: string[], blockedBots: string[]): string {
    if (!silentBlockDetected) return 'No CDN-level AI bot blocking detected. All AI crawlers can reach the site.';
    const vendor = cdnVendor || 'your CDN/WAF';
    if (blockedSearch.length > 0) {
      return `CRITICAL: ${vendor} is silently blocking AI search crawlers (${blockedSearch.join(', ')}). The site's robots.txt may allow them, but the CDN returns a block. Check the ${vendor} dashboard for an "AI Bot" or "Bot Management" setting and add Allow rules for these crawlers.`;
    }
    return `${vendor} appears to be blocking AI bots (${blockedBots.join(', ')}). Check the ${vendor} bot management settings. The site's robots.txt allows these bots, but the CDN is overriding it.`;
  }
}
