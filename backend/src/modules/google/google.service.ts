/**
 * Google Service — OAuth connect + live Search Console / Analytics reads.
 *
 * One connection per client (refresh token AES-256-GCM encrypted at rest,
 * scopes merged across grants). Site/property matching is per project
 * domain at fetch time, so nothing goes stale in storage — and every read
 * is live; no metrics are ever persisted. See docs/analysis/google.md.
 *
 * Honest guards (same posture as every integration here):
 *  - client id/secret unset → 503 `google-unconfigured`, nothing attempted;
 *  - no connection / missing scope → 404 `google-not-connected`;
 *  - Google API error or revoked grant → 503 `google-fetch-failed`.
 *
 * @module google/google.service
 */

import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  PROVIDER_SCOPES,
  type GaDateRow,
  type GaOverview,
  type GaTotals,
  type GoogleProvider,
  type GoogleStatus,
  type GscDateRow,
  type GscIndexCoverage,
  type GscOverview,
  type GscRow,
  type GscTotals,
  type PageInsight,
} from './google.types.js';

/** Code-level fallback — validation.schema.ts carries the same default. */
const DEFAULT_REDIRECT_URI = 'http://localhost:3001/auth/google/callback';
const DEFAULT_FRONTEND_URL = 'http://localhost:3000';

/** Strip a site URL / domain down to its bare host for matching. */
export function normalizeHost(input: string): string {
  let host = input.trim().toLowerCase();
  host = host.replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/^www\./, '');
  host = host.split(/[/?#]/)[0]!;
  return host.replace(/[./]+$/, '');
}

/** True when Google rejected a call for missing grant scope (unchecked box, revoked grant). */
export function isInsufficientScope(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (code === 403 || code === '403') return true;
  const message = err instanceof Error ? err.message : String(err);
  return /insufficient authentication scopes/i.test(message);
}

/** The provider scopes a granted scope string actually contains — the consent screen lets users uncheck boxes. */
export function scopesFromGranted(scope: string | undefined): string[] {
  const parts = (scope ?? '').split(/\s+/);
  const out: string[] = [];
  if (parts.includes(PROVIDER_SCOPES.gsc)) out.push(PROVIDER_SCOPES.gsc);
  if (parts.includes(PROVIDER_SCOPES.ga)) out.push(PROVIDER_SCOPES.ga);
  return out;
}

/** First GSC site containing the project domain, else null. Exact host wins over parent/subdomain matches. */
export function matchGscSite(sites: Array<{ siteUrl?: string | null }>, domain: string): string | null {
  const want = normalizeHost(domain);
  if (!want) return null;
  const hosts = sites.flatMap((s) => (s.siteUrl ? [{ raw: s.siteUrl, host: normalizeHost(s.siteUrl) }] : []));
  const exact = hosts.find((s) => s.host === want);
  if (exact) return exact.raw;
  const related = hosts.find((s) => s.host.endsWith(`.${want}`) || want.endsWith(`.${s.host}`));
  return related?.raw ?? null;
}

/**
 * Per-page period-over-period intelligence — the Organic tab's value over
 * raw Search Console. Pure and fully tested; thresholds are documented
 * heuristics, not model judgments:
 * - climbed ≥2 spots → up; slipped ≥3 → down (+ slipping action);
 * - clicks −20%+ at stable rank → CTR action; impressions −30%+ → visibility watch;
 * - position 11–20 with above-median impressions → striking-distance action;
 * - entering page 1 → win note; no previous row → new.
 * One action per page, first match wins; null when there is nothing to do.
 */
export function buildPageInsights(current: GscRow[], previous: GscRow[]): PageInsight[] {
  const prevByKey = new Map(previous.map((r) => [r.key, r]));
  const medianImpressions = median(current.map((r) => r.impressions));

  return current.map((row) => {
    const prev = prevByKey.get(row.key) ?? null;
    const onPageOne = row.position > 0 && row.position <= 10;

    if (!prev || (prev.impressions === 0 && prev.clicks === 0)) {
      const active = row.clicks > 0 || row.impressions > 0;
      return {
        url: row.key,
        clicks: row.clicks,
        prevClicks: null,
        impressions: row.impressions,
        prevImpressions: null,
        position: row.position,
        prevPosition: null,
        onPageOne,
        trend: active ? 'new' : 'stable',
        action: active ? 'New in this period. Watch whether it holds its position.' : null,
        actionLevel: active ? 'win' : null,
      } as PageInsight;
    }

    const posMove = prev.position > 0 && row.position > 0 ? prev.position - row.position : 0;
    const clickDrop = prev.clicks > 0 ? (row.clicks - prev.clicks) / prev.clicks : 0;
    const imprDrop = prev.impressions > 0 ? (row.impressions - prev.impressions) / prev.impressions : 0;

    let trend: PageInsight['trend'] = 'stable';
    let action: string | null = null;
    let actionLevel: PageInsight['actionLevel'] = null;

    if (posMove <= -3) {
      trend = 'down';
      action = `Slipping ${Math.abs(Math.round(posMove))} places. Refresh the content and check it still answers what people are searching for.`;
      actionLevel = 'act';
    } else if (clickDrop <= -0.2 && posMove >= -1) {
      trend = 'down';
      action = 'Clicks are falling while the position holds, so fewer people choose your result. Rework the page title and description.';
      actionLevel = 'act';
    } else if (imprDrop <= -0.3) {
      trend = 'down';
      action = 'Showing up less often, even where it still ranks.';
      actionLevel = 'watch';
    } else if (posMove >= 2) {
      trend = 'up';
      if (onPageOne && prev.position > 10) {
        action = 'Reached page one. Keep the content fresh to hold it.';
      } else {
        action = `Climbed ${Math.round(posMove)} places. On the right track.`;
      }
      actionLevel = 'win';
    } else if (row.position > 10 && row.position <= 20 && row.impressions >= medianImpressions && medianImpressions > 0) {
      action = 'Close to page one. A title and content tune-up could get it there.';
      actionLevel = 'act';
    }

    return {
      url: row.key,
      clicks: row.clicks,
      prevClicks: prev.clicks,
      impressions: row.impressions,
      prevImpressions: prev.impressions,
      position: row.position,
      prevPosition: prev.position,
      onPageOne,
      trend,
      action,
      actionLevel,
    };
  });
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Sum sitemap contents into coverage — pure, tested. */
export function sumSitemapCoverage(
  sitemaps: Array<{ path: string; contents: Array<{ submitted?: number | null; indexed?: number | null }> }>,
): GscIndexCoverage {
  const rows = sitemaps.map((s) => ({
    path: s.path,
    submitted: s.contents.reduce((n, c) => n + (c.submitted ?? 0), 0),
    indexed: s.contents.reduce((n, c) => n + (c.indexed ?? 0), 0),
  }));
  const submitted = rows.reduce((n, r) => n + r.submitted, 0);
  const indexed = rows.reduce((n, r) => n + r.indexed, 0);
  return { submitted, indexed, notIndexed: Math.max(0, submitted - indexed), sitemaps: rows };
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function rangeDays(days: number, offsetDays = 0): { startDate: string; endDate: string } {
  const end = new Date(Date.now() - offsetDays * 24 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return { startDate: toDateString(start), endDate: toDateString(end) };
}

@Injectable()
export class GoogleService {
  private readonly logger = new Logger(GoogleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  /** False when the OAuth client is not configured — callers report honestly. */
  isConfigured(): boolean {
    return Boolean(this.config.get<string>('GOOGLE_CLIENT_ID')) && Boolean(this.config.get<string>('GOOGLE_CLIENT_SECRET'));
  }

  private assertConfigured(): { clientId: string; clientSecret: string; redirectUri: string } {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new ServiceUnavailableException('google-unconfigured: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET is not set. Nothing was attempted');
    }
    const redirectUri = this.config.get<string>('GOOGLE_REDIRECT_URI', DEFAULT_REDIRECT_URI) ?? DEFAULT_REDIRECT_URI;
    return { clientId, clientSecret, redirectUri };
  }

  private oauthClient(): OAuth2Client {
    const { clientId, clientSecret, redirectUri } = this.assertConfigured();
    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }

  // ─── OAuth connect ────────────────────────────────────────────────

  /** Consent URL for one provider scope. POC-only (enforced by the controller). */
  async connectUrl(clientId: string, provider: GoogleProvider): Promise<{ url: string }> {
    this.assertConfigured();
    await this.getClientOrThrow(clientId);
    const state = await this.jwt.signAsync(
      { purpose: 'google-oauth', clientId, provider, nonce: randomUUID() },
      { expiresIn: '10m' },
    );
    const url = this.oauthClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: PROVIDER_SCOPES[provider],
      state,
    });
    return { url };
  }

  /**
   * Exchanges the callback code and stores the refresh token. Returns the
   * client id so the controller can redirect into the right workspace.
   */
  async handleCallback(code: string, state: string): Promise<{ clientId: string }> {
    let payload: { purpose?: string; clientId?: string; provider?: GoogleProvider };
    try {
      payload = await this.jwt.verifyAsync(state);
    } catch {
      throw new BadRequestException('This Google sign-in link is invalid or has expired. Start over from the connect button.');
    }
    if (payload.purpose !== 'google-oauth' || !payload.clientId || (payload.provider !== 'gsc' && payload.provider !== 'ga')) {
      throw new BadRequestException('This Google sign-in link is invalid or has expired. Start over from the connect button.');
    }

    const oauth = this.oauthClient();
    let refreshToken: string | null | undefined;
    let grantedScope: string | undefined;
    try {
      const { tokens } = await oauth.getToken(code);
      refreshToken = tokens.refresh_token;
      grantedScope = tokens.scope;
    } catch (err) {
      throw new ServiceUnavailableException(`google-fetch-failed: Google rejected the authorization code (${(err as Error).message})`);
    }
    if (!refreshToken) {
      throw new BadRequestException('Google did not return a refresh token. Remove the Cailyx grant at myaccount.google.com/permissions and reconnect.');
    }

    // Store what Google actually granted, not what was requested — the
    // consent screen lets users uncheck boxes, and unchecking revokes that
    // scope account-wide, so merging with old rows would preserve a lie.
    // (Falls back to the requested scope only when Google omits the field.)
    const granted = scopesFromGranted(grantedScope);
    const scopes = granted.length > 0 ? granted : [PROVIDER_SCOPES[payload.provider]];
    await this.prisma.googleConnection.upsert({
      where: { clientId: payload.clientId },
      create: { clientId: payload.clientId, scopes, refreshTokenEncrypted: this.encrypt(refreshToken) },
      update: { scopes, refreshTokenEncrypted: this.encrypt(refreshToken) },
    });
    return { clientId: payload.clientId };
  }

  /**
   * Maps a Google API failure to the honest error: revoked/unchecked
   * grants surface as 403 `google-scope-missing` (reconnect fixes it),
   * everything else as 503 `google-fetch-failed`.
   */
  private googleError(operation: string, err: unknown): never {
    if (isInsufficientScope(err)) {
      throw new ForbiddenException(
        'google-scope-missing: this Google account has not granted the needed access. Reconnect and check every box on the consent screen.',
      );
    }
    throw new ServiceUnavailableException(`google-fetch-failed: ${operation} (${(err as Error).message})`);
  }

  /** Which providers are linked. Site/property matching is per project, reported by the overview endpoints. */
  async getStatus(clientId: string): Promise<GoogleStatus> {
    const row = await this.prisma.googleConnection.findUnique({ where: { clientId } });
    const scopes = row?.scopes ?? [];
    return {
      gsc: { connected: scopes.includes(PROVIDER_SCOPES.gsc) },
      ga: { connected: scopes.includes(PROVIDER_SCOPES.ga) },
    };
  }

  /** Revokes the grant at Google (best-effort) and deletes the row. */
  async disconnect(clientId: string): Promise<{ success: true }> {
    const row = await this.prisma.googleConnection.findUnique({ where: { clientId } });
    if (!row) return { success: true };
    try {
      await new OAuth2Client().revokeToken(this.decrypt(row.refreshTokenEncrypted));
    } catch (err) {
      this.logger.warn(`Google revoke failed for client ${clientId}: ${(err as Error).message}. Deleting the local row anyway.`);
    }
    await this.prisma.googleConnection.delete({ where: { clientId } });
    return { success: true };
  }

  // ─── Search Console ───────────────────────────────────────────────

  /** Every Search Console site on the linked account (manual-pick fallback). */
  async listGscSites(clientId: string, projectId: string): Promise<string[]> {
    await this.assertProjectInClient(projectId, clientId);
    const oauth = await this.authorizedClientFor(clientId, PROVIDER_SCOPES.gsc);
    try {
      const sites = await google.webmasters({ version: 'v3', auth: oauth }).sites.list();
      return (sites.data.siteEntry ?? []).map((s) => s.siteUrl ?? '').filter(Boolean);
    } catch (err) {
      this.googleError('could not list Search Console sites', err);
    }
  }

  async getSearchConsole(clientId: string, projectId: string, days: number, siteUrl?: string): Promise<GscOverview> {
    const project = await this.assertProjectInClient(projectId, clientId);
    const oauth = await this.authorizedClientFor(clientId, PROVIDER_SCOPES.gsc);
    const webmasters = google.webmasters({ version: 'v3', auth: oauth });

    let site: string;
    try {
      const sites = await webmasters.sites.list();
      const available = (sites.data.siteEntry ?? []).map((s) => s.siteUrl ?? '').filter(Boolean);
      if (siteUrl) {
        if (!available.includes(siteUrl)) {
          throw new NotFoundException('google-no-site: that property is not on this Google account.');
        }
        site = siteUrl;
      } else {
        const matched = matchGscSite(available.map((s) => ({ siteUrl: s })), project.domain);
        if (!matched) {
          throw new NotFoundException(`google-no-site: this Google account has no Search Console property for ${project.domain}.`);
        }
        site = matched;
      }
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.googleError('could not list Search Console sites', err);
    }

    const current = rangeDays(days);
    const previous = rangeDays(days, days);
    let byQuery: GscRow[];
    let byPage: GscRow[];
    let byDate: GscDateRow[];
    let prevRows: GscRow[];
    let prevPages: GscRow[];
    let pageDateRows: Array<{ url: string; date: string; clicks: number }>;
    try {
      const api = webmasters.searchanalytics;
      const [q, p, d, prev, prevP, pd] = await Promise.all([
        api.query({ siteUrl: site, requestBody: { ...current, dimensions: ['query'], rowLimit: 10 } }),
        api.query({ siteUrl: site, requestBody: { ...current, dimensions: ['page'], rowLimit: 100 } }),
        api.query({ siteUrl: site, requestBody: { ...current, dimensions: ['date'], rowLimit: 100 } }),
        api.query({ siteUrl: site, requestBody: { ...previous, rowLimit: 1000 } }),
        api.query({ siteUrl: site, requestBody: { ...previous, dimensions: ['page'], rowLimit: 1000 } }),
        api.query({ siteUrl: site, requestBody: { ...current, dimensions: ['page', 'date'], rowLimit: 5000 } }),
      ]);
      byQuery = (q.data.rows ?? []).map((r) => this.gscRow(r.keys?.[0] ?? '(unknown)', r));
      byPage = (p.data.rows ?? []).map((r) => this.gscRow(r.keys?.[0] ?? '(unknown)', r));
      byDate = (d.data.rows ?? []).map((r) => ({ ...this.gscRow(r.keys?.[0] ?? '', r), date: r.keys?.[0] ?? '' }));
      prevRows = (prev.data.rows ?? []).map((r) => this.gscRow('', r));
      prevPages = (prevP.data.rows ?? []).map((r) => this.gscRow(r.keys?.[0] ?? '', r));
      pageDateRows = (pd.data.rows ?? []).map((r) => ({
        url: r.keys?.[0] ?? '',
        date: r.keys?.[1] ?? '',
        clicks: r.clicks ?? 0,
      }));
    } catch (err) {
      this.googleError('Search Console query failed', err);
    }

    // Daily trends for the top pages only — a full page×date matrix would
    // blow the row budget on large sites.
    const topUrls = new Set([...byPage].sort((a, b) => b.clicks - a.clicks).slice(0, 8).map((r) => r.key));
    const pageTrends = pageDateRows.filter((r) => r.url !== '' && topUrls.has(r.url));

    // Sitemap submitted-vs-indexed coverage — best-effort: a failure here
    // must not fail the overview (the property may simply list no sitemaps).
    let indexCoverage: GscIndexCoverage | null = null;
    try {
      const listed = await webmasters.sitemaps.list({ siteUrl: site });
      const paths = (listed.data.sitemap ?? []).map((s) => s.path ?? '').filter(Boolean);
      if (paths.length > 0) {
        const details = await Promise.all(
          paths.slice(0, 10).map((path) => webmasters.sitemaps.get({ siteUrl: site, feedpath: path })),
        );
        indexCoverage = sumSitemapCoverage(
          details.map((d, i) => ({
            path: paths[i],
            contents: (d.data.contents ?? []).map((c) => ({
              submitted: typeof c.submitted === 'string' ? Number(c.submitted) : (c.submitted ?? 0),
              indexed: typeof c.indexed === 'string' ? Number(c.indexed) : (c.indexed ?? 0),
            })),
          })),
        );
      }
    } catch (err) {
      this.logger.warn(`Sitemap coverage unreadable for ${site}: ${(err as Error).message}`);
    }

    return {
      siteUrl: site,
      days,
      totals: this.gscTotals(byDate),
      previousTotals: this.gscTotals(prevRows),
      byQuery,
      byPage,
      byDate,
      pageInsights: buildPageInsights(byPage, prevPages),
      pageTrends,
      indexCoverage,
    };
  }

  private gscRow(
    key: string,
    row: { clicks?: number | null; impressions?: number | null; ctr?: number | null; position?: number | null },
  ): GscRow {
    return {
      key,
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0,
    };
  }

  private gscTotals(rows: GscRow[]): GscTotals {
    const clicks = rows.reduce((n, r) => n + r.clicks, 0);
    const impressions = rows.reduce((n, r) => n + r.impressions, 0);
    const position =
      impressions > 0 ? rows.reduce((n, r) => n + r.position * r.impressions, 0) / impressions : null;
    return { clicks, impressions, ctr: impressions > 0 ? clicks / impressions : null, position };
  }

  // ─── Analytics ────────────────────────────────────────────────────

  /** Every Analytics property on the linked account (manual-pick fallback). */
  async listGaProperties(clientId: string, projectId: string): Promise<Array<{ id: string; name: string }>> {
    await this.assertProjectInClient(projectId, clientId);
    const oauth = await this.authorizedClientFor(clientId, PROVIDER_SCOPES.ga);
    try {
      return await this.gaPropertyCandidates(google.analyticsadmin({ version: 'v1alpha', auth: oauth }));
    } catch (err) {
      this.googleError('could not list Analytics properties', err);
    }
  }

  async getAnalytics(clientId: string, projectId: string, days: number, propertyId?: string): Promise<GaOverview> {
    const project = await this.assertProjectInClient(projectId, clientId);
    const oauth = await this.authorizedClientFor(clientId, PROVIDER_SCOPES.ga);
    const admin = google.analyticsadmin({ version: 'v1alpha', auth: oauth });
    const data = google.analyticsdata({ version: 'v1beta', auth: oauth });

    let property: string;
    try {
      if (propertyId) {
        const candidates = await this.gaPropertyCandidates(admin);
        if (!candidates.some((c) => c.id === propertyId)) {
          throw new NotFoundException('google-no-property: that property is not on this Google account.');
        }
        property = propertyId;
      } else {
        const matched = await this.matchGaProperty(admin, project.domain);
        if (!matched) {
          throw new NotFoundException(`google-no-property: this Google account has no Analytics property for ${project.domain}.`);
        }
        property = matched;
      }
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.googleError('could not list Analytics properties', err);
    }

    const current = rangeDays(days);
    const previous = rangeDays(days, days);
    try {
      const [cur, prev] = await Promise.all([
        data.properties.runReport({
          property,
          requestBody: {
            dateRanges: [current],
            dimensions: [{ name: 'date' }],
            metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'screenPageViews' }],
            orderBys: [{ dimension: { dimensionName: 'date' } }],
            limit: '10000',
          },
        }),
        data.properties.runReport({
          property,
          requestBody: {
            dateRanges: [previous],
            metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'screenPageViews' }],
            limit: '10',
          },
        }),
      ]);
      const byDate = (cur.data.rows ?? []).map((r) => ({
        date: r.dimensionValues?.[0]?.value ?? '',
        sessions: Number(r.metricValues?.[0]?.value ?? 0),
        activeUsers: Number(r.metricValues?.[1]?.value ?? 0),
        screenPageViews: Number(r.metricValues?.[2]?.value ?? 0),
      }));
      const sum = (rows: GaDateRow[]): GaTotals => ({
        sessions: rows.reduce((n, r) => n + r.sessions, 0),
        activeUsers: rows.reduce((n, r) => n + r.activeUsers, 0),
        screenPageViews: rows.reduce((n, r) => n + r.screenPageViews, 0),
      });
      const prevTotals = sum(
        (prev.data.rows ?? []).map((r) => ({
          date: '',
          sessions: Number(r.metricValues?.[0]?.value ?? 0),
          activeUsers: Number(r.metricValues?.[1]?.value ?? 0),
          screenPageViews: Number(r.metricValues?.[2]?.value ?? 0),
        })),
      );
      return { propertyId: property, days, totals: sum(byDate), previousTotals: prevTotals, byDate };
    } catch (err) {
      this.googleError('Analytics query failed', err);
    }
  }

  /** All properties on the account (id + display name) — shared by matching and listing. */
  private async gaPropertyCandidates(
    admin: ReturnType<typeof google.analyticsadmin>,
  ): Promise<Array<{ id: string; name: string }>> {
    const summaries = await admin.accountSummaries.list({ pageSize: 200 });
    const candidates: Array<{ id: string; name: string }> = [];
    for (const account of summaries.data.accountSummaries ?? []) {
      for (const property of account.propertySummaries ?? []) {
        if (property.property) candidates.push({ id: property.property, name: property.displayName ?? property.property });
      }
    }
    return candidates;
  }

  /**
   * First property whose display name contains the domain stem, else the
   * first property, else null. (GA4 properties expose no website URL in
   * this API version, so the name is the only matchable signal.)
   */
  private async matchGaProperty(admin: ReturnType<typeof google.analyticsadmin>, domain: string): Promise<string | null> {
    const stem = normalizeHost(domain).split('.')[0];
    const candidates = await this.gaPropertyCandidates(admin);
    return (
      candidates.find((c) => c.name.toLowerCase().includes(stem))?.id ??
      candidates[0]?.id ??
      null
    );
  }

  // ─── Token handling ───────────────────────────────────────────────

  private encryptionKey(): Buffer {
    const hex = this.config.get<string>('GOOGLE_TOKEN_ENCRYPTION_KEY');
    const key = hex ? Buffer.from(hex, 'hex') : Buffer.alloc(0);
    if (key.length !== 32) {
      throw new ServiceUnavailableException('google-misconfigured: GOOGLE_TOKEN_ENCRYPTION_KEY must be 32 random bytes as hex. Nothing was attempted');
    }
    return key;
  }

  /** `iv:tag:ciphertext` (hex) — random IV per encryption. */
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${data.toString('hex')}`;
  }

  decrypt(packed: string): string {
    try {
      const [ivHex, tagHex, dataHex] = packed.split(':');
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException('google-token-invalid: the stored Google credential is corrupt. Reconnect the account');
    }
  }

  private async authorizedClient(refreshTokenEncrypted: string): Promise<OAuth2Client> {
    const oauth = this.oauthClient();
    oauth.setCredentials({ refresh_token: this.decrypt(refreshTokenEncrypted) });
    return oauth;
  }

  private async authorizedClientFor(clientId: string, scope: string): Promise<OAuth2Client> {
    const row = await this.prisma.googleConnection.findUnique({ where: { clientId } });
    if (!row || !row.scopes.includes(scope)) {
      throw new NotFoundException('google-not-connected: this Google account is not connected. Connect it first.');
    }
    return this.authorizedClient(row.refreshTokenEncrypted);
  }

  private async getClientOrThrow(clientId: string) {
    const client = await this.prisma.client.findFirst({ where: { id: clientId, deletedAt: null } });
    if (!client) throw new NotFoundException('Client not found.');
    return client;
  }

  private async assertProjectInClient(projectId: string, clientId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null } });
    if (!project) throw new NotFoundException('Project not found.');
    return project;
  }

  frontendUrl(): string {
    return this.config.get<string>('FRONTEND_URL', DEFAULT_FRONTEND_URL) ?? DEFAULT_FRONTEND_URL;
  }
}
