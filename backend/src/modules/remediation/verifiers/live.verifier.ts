/**
 * Live verifier — re-reads the client's site fresh (cache bypassed) and
 * checks a fix spec's acceptance check using the technical audit's own
 * exported code (`extractPageSignals`, `findPageIssues`, the RobotsService
 * matcher), so "verified" means exactly "the audit would no longer report
 * this". `finding-absent` checks are not live-checkable — they are settled
 * by the next audit during sync.
 *
 * @module remediation/verifiers/live.verifier
 */

import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { getBotByName } from '../../fetcher/fetcher.constants.js';
import { FetcherService } from '../../fetcher/fetcher.service.js';
import { parseRobotsTxt } from '../../fetcher/services/robots.service.js';
import { extractPageSignals } from '../../technical-audit/services/checks/page-signals.js';
import { findPageIssues } from '../../technical-audit/services/checks/seo-rubric.js';
import { robotsRootVerdicts } from '../generators/robots-verdict.js';
import { LIVE_ACCEPTANCE_KINDS, type AcceptanceCheck, type VerifyResult } from '../remediation.types.js';

const CALLED_BY = 'remediation';

export function isLiveCheckable(check: AcceptanceCheck): boolean {
  return LIVE_ACCEPTANCE_KINDS.includes(check.kind);
}

@Injectable()
export class LiveVerifier {
  constructor(private readonly fetcher: FetcherService) {}

  async verify(check: AcceptanceCheck, siteUrl: string): Promise<VerifyResult> {
    const result = (passed: boolean, observed: string): VerifyResult => ({ passed, observed, kind: check.kind, checkedAt: new Date().toISOString() });

    switch (check.kind) {
      case 'robots-exists': {
        const res = await this.fresh(`${siteUrl}/robots.txt`);
        return result(res.status >= 200 && res.status < 300, `/robots.txt returned HTTP ${res.status}.`);
      }
      case 'robots-allows': {
        const res = await this.fresh(`${siteUrl}/robots.txt`);
        if (res.status === 0) return result(false, 'Could not fetch /robots.txt (network error). Try again.');
        const body = res.status >= 400 ? '' : res.body;
        const bots = check.bots.map((n) => getBotByName(n)).filter((b): b is NonNullable<typeof b> => !!b);
        const verdicts = await robotsRootVerdicts(body, bots.map((b) => b.userAgent));
        const blocked = bots.filter((b) => verdicts.get(b.userAgent) === false).map((b) => b.name);
        return result(
          blocked.length === 0,
          blocked.length === 0 ? `All ${bots.length} bot(s) are allowed at "/".` : `Still blocked at "/": ${blocked.join(', ')}.`,
        );
      }
      case 'robots-declares-sitemap': {
        const res = await this.fresh(`${siteUrl}/robots.txt`);
        const sitemaps = res.status >= 200 && res.status < 300 ? parseRobotsTxt(res.body).sitemaps : [];
        return result(sitemaps.length > 0, sitemaps.length > 0 ? `Declared: ${sitemaps.join(', ')}.` : 'No "Sitemap:" line in /robots.txt.');
      }
      case 'json-ld-has': {
        const res = await this.fresh(check.url);
        if (res.status === 0 || res.status >= 400) return result(false, `${check.url} returned HTTP ${res.status}.`);
        const org = findOrganization(res.body);
        if (!org) return result(false, 'No Organization JSON-LD block found.');
        const missing = check.fields.filter((f) => isEmpty(org[f]));
        return result(missing.length === 0, missing.length === 0 ? 'Organization block has every required field.' : `Organization block still missing: ${missing.join(', ')}.`);
      }
      case 'page-issue-absent': {
        const res = await this.fresh(check.url);
        const host = safeHost(check.url);
        const signals = extractPageSignals(res.body ?? '', res.status, check.url, host);
        const found = findPageIssues(signals, check.url, host);
        const still = check.issues.filter((i) => found.includes(i));
        return result(still.length === 0, still.length === 0 ? `No longer reported: ${check.issues.join(', ')}.` : `Still reported: ${still.join(', ')}.`);
      }
      case 'finding-absent':
        throw new Error('finding-absent checks are settled by the next audit, not a live check.');
      case 'manual':
        throw new Error('Manual fixes have no live check. An admin confirms them.');
    }
  }

  private fresh(url: string) {
    return this.fetcher.fetch({ url, bypassCache: true, cacheTtlSeconds: 0 }, CALLED_BY);
  }
}

/** First Organization-like JSON-LD object on the page, walking `@graph`. */
export function findOrganization(html: string): Record<string, unknown> | null {
  const $ = cheerio.load(html);
  const candidates: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      candidates.push(JSON.parse($(el).text().trim()));
    } catch {
      // invalid JSON-LD is its own page issue; it just can't satisfy this check
    }
  });
  const stack = [...candidates];
  while (stack.length > 0) {
    const node = stack.shift();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (!node || typeof node !== 'object') continue;
    const obj = node as Record<string, unknown>;
    const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
    if (types.some((t) => typeof t === 'string' && (t.includes('Organization') || t.includes('LocalBusiness')))) return obj;
    if (Array.isArray(obj['@graph'])) stack.push(...obj['@graph']);
  }
  return null;
}

function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
