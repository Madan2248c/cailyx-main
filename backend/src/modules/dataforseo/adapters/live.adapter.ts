/**
 * Live DataForSEO adapter: real keyword, ranking and backlink data.
 *
 * Off unless `DATAFORSEO_LIVE=1` and both `DATAFORSEO_LOGIN` and
 * `DATAFORSEO_PASSWORD` are set (`LiveDataforseoAdapter.isEnabled`). It costs
 * real credit, so the service also demands an explicit `confirmSpend` on every
 * manual collect, and scheduled collects need the schedule's spend opt-in.
 *
 * Every dataset returns exactly the payload shape the mock adapter uses, so
 * snapshots, the client pages and the reports read live and mock data the same
 * way. Credentials are used only for the Authorization header: never logged,
 * never returned, never stored in a snapshot.
 *
 * Endpoint map:
 * - backlinks-summary   <- backlinks/summary + backlinks/timeseries_new_lost_summary
 * - backlink-rows       <- backlinks/backlinks
 * - referring-domains   <- backlinks/referring_domains
 * - top-pages           <- backlinks/domain_pages
 * - serp-ranks, keyword-overview <- dataforseo_labs/google/ranked_keywords
 * - keyword-ideas       <- dataforseo_labs/google/keyword_ideas
 * - serp-snapshot       <- serp/google/organic/live/advanced
 * - domain-overview     <- dataforseo_labs/google/domain_rank_overview + backlinks/summary
 *
 * @module dataforseo/adapters/live.adapter
 */

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  BacklinkRow,
  DataforseoAdapter,
  DataforseoDataset,
  DataforseoPayload,
  DatasetResult,
  KeywordIdeaRow,
  KeywordOverviewRow,
  ReferringDomainRow,
  SerpRankRow,
  SerpSnapshotResultRow,
  TopPageRow,
} from '../dataforseo.types.js';

const API_BASE = 'https://api.dataforseo.com/v3/';
const REQUEST_TIMEOUT_MS = 45_000;
/** Repeat reads inside one collect (several datasets share ranked keywords) are served from memory, not re-billed. */
const CACHE_TTL_MS = 5 * 60_000;
const OK = 20000;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

interface Call {
  result: Json[];
  costUsd: number;
}

/** Country by domain ending → DataForSEO location code. Anything else falls back to the US. */
const LOCATION_BY_SUFFIX: Array<[RegExp, number]> = [
  [/\.in$/, 2356],
  [/\.(co\.uk|uk)$/, 2826],
  [/\.(com\.au|au)$/, 2036],
  [/\.ca$/, 2124],
  [/\.sg$/, 2702],
  [/\.ae$/, 784],
];
const DEFAULT_LOCATION = 2840;

/** Bare host: no scheme, no www, no path. DataForSEO's `target` format. */
export function normalizeTarget(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '');
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const iso = (v: unknown): string | null => {
  if (typeof v !== 'string' || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

@Injectable()
export class LiveDataforseoAdapter implements DataforseoAdapter {
  readonly name = 'live' as const;
  private readonly logger = new Logger(LiveDataforseoAdapter.name);
  private readonly cache = new Map<string, { at: number; call: Call }>();

  constructor(private readonly config: ConfigService) {}

  /** Live is opt-in: the switch and both credentials must be present. */
  static isEnabled(config: ConfigService): boolean {
    return (
      config.get<string>('DATAFORSEO_LIVE') === '1' &&
      Boolean(config.get<string>('DATAFORSEO_LOGIN')) &&
      Boolean(config.get<string>('DATAFORSEO_PASSWORD'))
    );
  }

  async fetchDataset(dataset: DataforseoDataset, domain: string): Promise<DatasetResult> {
    if (!LiveDataforseoAdapter.isEnabled(this.config)) {
      throw new ServiceUnavailableException('Live DataForSEO is not enabled (needs DATAFORSEO_LIVE=1 and login/password).');
    }
    const target = normalizeTarget(domain);
    const paid = { cost: 0 };
    const payload = await this.build(dataset, target, paid);
    return { payload, costUsd: Math.round(paid.cost * 1e6) / 1e6 };
  }

  // ─── Datasets ────────────────────────────────────────────────────────

  private async build(dataset: DataforseoDataset, target: string, paid: { cost: number }): Promise<DataforseoPayload> {
    switch (dataset) {
      case 'backlinks-summary': {
        const summary = await this.backlinksSummary(target, paid);
        const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
        const to = new Date().toISOString().slice(0, 10);
        const series = await this.call('backlinks/timeseries_new_lost_summary/live', [{ target, date_from: from, date_to: to, group_range: 'month' }], paid);
        const items: Json[] = series.result[0]?.items ?? [];
        return {
          dataset,
          referringDomains: num(summary?.referring_domains),
          newBacklinks: items.reduce((n, i) => n + num(i?.new_backlinks), 0),
          lostBacklinks: items.reduce((n, i) => n + num(i?.lost_backlinks), 0),
        };
      }
      case 'backlink-rows': {
        const r = await this.call(
          'backlinks/backlinks/live',
          [{ target, mode: 'as_is', include_subdomains: true, backlinks_status_type: 'all', limit: 100, order_by: ['rank,desc'] }],
          paid,
        );
        const backlinks: BacklinkRow[] = (r.result[0]?.items ?? []).map((i: Json) => ({
          sourceUrl: String(i.url_from ?? ''),
          targetUrl: String(i.url_to ?? ''),
          anchor: String(i.anchor ?? ''),
          isDofollow: i.dofollow === true,
          spamScore: typeof i.backlink_spam_score === 'number' ? i.backlink_spam_score : null,
          firstSeen: iso(i.first_seen),
          lastSeen: iso(i.last_seen),
          lost: i.is_lost === true,
        }));
        return { dataset, backlinks };
      }
      case 'referring-domains': {
        const r = await this.call(
          'backlinks/referring_domains/live',
          [{ target, include_subdomains: true, limit: 10, order_by: ['backlinks,desc'] }],
          paid,
        );
        const domains: ReferringDomainRow[] = (r.result[0]?.items ?? []).map((i: Json) => ({
          domain: String(i.domain ?? ''),
          backlinks: num(i.backlinks),
          firstSeen: iso(i.first_seen),
        }));
        return { dataset, domains };
      }
      case 'top-pages': {
        const r = await this.call('backlinks/domain_pages/live', [{ target, limit: 100 }], paid);
        const pages: TopPageRow[] = (r.result[0]?.items ?? [])
          .map((i: Json) => ({
            url: String(i.page ?? i.url ?? ''),
            backlinks: num(i.page_summary?.backlinks ?? i.backlinks),
            refDomains: num(i.page_summary?.referring_domains ?? i.referring_domains),
          }))
          .filter((p: TopPageRow) => p.url !== '' && p.backlinks > 0)
          .sort((a: TopPageRow, b: TopPageRow) => b.backlinks - a.backlinks)
          .slice(0, 10);
        return { dataset, pages };
      }
      case 'serp-ranks': {
        const items = await this.rankedKeywords(target, paid);
        const rankings: SerpRankRow[] = items
          .map((i) => {
            const serp = i.ranked_serp_element?.serp_item ?? {};
            return {
              keyword: String(i.keyword_data?.keyword ?? ''),
              url: String(serp.url ?? ''),
              position: num(serp.rank_absolute),
              prevPosition: typeof serp.rank_changes?.previous_rank_absolute === 'number' ? serp.rank_changes.previous_rank_absolute : null,
              volume: num(i.keyword_data?.keyword_info?.search_volume),
            };
          })
          .filter((r) => r.keyword !== '' && r.position > 0)
          .slice(0, 50);
        return { dataset, rankings };
      }
      case 'keyword-overview': {
        const items = await this.rankedKeywords(target, paid);
        const keywords: KeywordOverviewRow[] = items
          .map((i) => ({
            keyword: String(i.keyword_data?.keyword ?? ''),
            volume: num(i.keyword_data?.keyword_info?.search_volume),
            difficulty: num(i.keyword_data?.keyword_properties?.keyword_difficulty),
            cpc: num(i.keyword_data?.keyword_info?.cpc),
          }))
          .filter((k) => k.keyword !== '')
          .slice(0, 50);
        return { dataset, keywords };
      }
      case 'keyword-ideas': {
        const items = await this.rankedKeywords(target, paid);
        const seeds = items.map((i) => String(i.keyword_data?.keyword ?? '')).filter(Boolean).slice(0, 3);
        const r = await this.call(
          'dataforseo_labs/google/keyword_ideas/live',
          [{ keywords: seeds.length > 0 ? seeds : [this.brandLabel(target)], ...this.locale(target), limit: 30, order_by: ['keyword_info.search_volume,desc'] }],
          paid,
        );
        const keywords: KeywordIdeaRow[] = (r.result[0]?.items ?? []).map((i: Json) => ({
          keyword: String(i.keyword ?? ''),
          volume: num(i.keyword_info?.search_volume),
          difficulty: num(i.keyword_properties?.keyword_difficulty),
          cpc: num(i.keyword_info?.cpc),
        }));
        return { dataset, keywords: keywords.filter((k) => k.keyword !== '') };
      }
      case 'serp-snapshot': {
        const items = await this.rankedKeywords(target, paid);
        const keyword = String(items[0]?.keyword_data?.keyword ?? this.brandLabel(target));
        const r = await this.call('serp/google/organic/live/advanced', [{ keyword, ...this.locale(target), depth: 10 }], paid);
        const results: SerpSnapshotResultRow[] = (r.result[0]?.items ?? [])
          .filter((i: Json) => i.type === 'organic')
          .slice(0, 10)
          .map((i: Json) => ({ position: num(i.rank_absolute), url: String(i.url ?? ''), title: String(i.title ?? ''), features: [] }));
        return { dataset, keyword, results };
      }
      case 'domain-overview': {
        const summary = await this.backlinksSummary(target, paid);
        const r = await this.call('dataforseo_labs/google/domain_rank_overview/live', [{ target, ...this.locale(target) }], paid);
        const organic = r.result[0]?.items?.[0]?.metrics?.organic ?? {};
        return {
          dataset,
          rank: num(summary?.rank),
          rankedKeywords: num(organic.count),
          trafficEstimate: Math.round(num(organic.etv)),
          refDomains: num(summary?.referring_domains),
        };
      }
    }
  }

  private async backlinksSummary(target: string, paid: { cost: number }): Promise<Json | undefined> {
    const r = await this.call('backlinks/summary/live', [{ target, include_subdomains: true }], paid);
    return r.result[0];
  }

  private async rankedKeywords(target: string, paid: { cost: number }): Promise<Json[]> {
    const r = await this.call(
      'dataforseo_labs/google/ranked_keywords/live',
      [{ target, ...this.locale(target), limit: 100, order_by: ['keyword_data.keyword_info.search_volume,desc'] }],
      paid,
    );
    return r.result[0]?.items ?? [];
  }

  // ─── Plumbing ────────────────────────────────────────────────────────

  private locale(target: string): { location_code: number; language_code: string } {
    const override = Number(this.config.get<string>('DATAFORSEO_LOCATION_CODE'));
    const code = Number.isInteger(override) && override > 0 ? override : (LOCATION_BY_SUFFIX.find(([re]) => re.test(target))?.[1] ?? DEFAULT_LOCATION);
    return { location_code: code, language_code: 'en' };
  }

  /** "faydo.in" → "faydo": a last-resort seed when a domain has no ranked keywords yet. */
  private brandLabel(target: string): string {
    return target.split('.')[0] ?? target;
  }

  /** One authenticated call. Adds to `paid.cost` only when it actually hit the API (cache hits are free). */
  private async call(path: string, body: Json[], paid: { cost: number }): Promise<Call> {
    const key = `${path}|${JSON.stringify(body)}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.call;

    const login = this.config.get<string>('DATAFORSEO_LOGIN') ?? '';
    const password = this.config.get<string>('DATAFORSEO_PASSWORD') ?? '';
    let res: Response;
    try {
      res = await fetch(API_BASE + path, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new ServiceUnavailableException(`DataForSEO request failed (${path}): ${(err as Error).message}`);
    }
    const json: Json = await res.json().catch(() => ({}));
    const task: Json = json?.tasks?.[0];
    if (!res.ok || json?.status_code !== OK || task?.status_code !== OK) {
      const code = task?.status_code ?? json?.status_code ?? res.status;
      const message = String(task?.status_message ?? json?.status_message ?? res.statusText ?? 'error').slice(0, 160);
      this.logger.warn(`DataForSEO ${path} failed: ${code} ${message}`);
      throw new ServiceUnavailableException(`DataForSEO ${path} returned ${code}: ${message}`);
    }
    const call: Call = { result: task.result ?? [], costUsd: num(task.cost, num(json.cost)) };
    paid.cost += call.costUsd;
    this.cache.set(key, { at: Date.now(), call });
    return call;
  }
}
