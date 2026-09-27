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

import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
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
  type GscOverview,
  type GscRow,
  type GscTotals,
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
      throw new ServiceUnavailableException('google-unconfigured: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET is not set — nothing was attempted');
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
      throw new BadRequestException('This Google sign-in link is invalid or has expired — start over from the connect button.');
    }
    if (payload.purpose !== 'google-oauth' || !payload.clientId || (payload.provider !== 'gsc' && payload.provider !== 'ga')) {
      throw new BadRequestException('This Google sign-in link is invalid or has expired — start over from the connect button.');
    }

    const oauth = this.oauthClient();
    let refreshToken: string | null | undefined;
    try {
      const { tokens } = await oauth.getToken(code);
      refreshToken = tokens.refresh_token;
    } catch (err) {
      throw new ServiceUnavailableException(`google-fetch-failed: Google rejected the authorization code (${(err as Error).message})`);
    }
    if (!refreshToken) {
      throw new BadRequestException('Google did not return a refresh token — remove the Cailyx grant at myaccount.google.com/permissions and reconnect.');
    }

    const existing = await this.prisma.googleConnection.findUnique({ where: { clientId: payload.clientId } });
    const scopes = [...new Set([...(existing?.scopes ?? []), PROVIDER_SCOPES[payload.provider]])];
    await this.prisma.googleConnection.upsert({
      where: { clientId: payload.clientId },
      create: { clientId: payload.clientId, scopes, refreshTokenEncrypted: this.encrypt(refreshToken) },
      update: { scopes, refreshTokenEncrypted: this.encrypt(refreshToken) },
    });
    return { clientId: payload.clientId };
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
      this.logger.warn(`Google revoke failed for client ${clientId}: ${(err as Error).message} — deleting the local row anyway.`);
    }
    await this.prisma.googleConnection.delete({ where: { clientId } });
    return { success: true };
  }

  // ─── Search Console ───────────────────────────────────────────────

  async getSearchConsole(clientId: string, projectId: string, days: number): Promise<GscOverview> {
    const project = await this.assertProjectInClient(projectId, clientId);
    const oauth = await this.authorizedClientFor(clientId, PROVIDER_SCOPES.gsc);
    const webmasters = google.webmasters({ version: 'v3', auth: oauth });

    let siteUrl: string;
    try {
      const sites = await webmasters.sites.list();
      const matched = matchGscSite((sites.data.siteEntry ?? []).map((s) => ({ siteUrl: s.siteUrl ?? null })), project.domain);
      if (!matched) {
        throw new NotFoundException(`google-no-site: this Google account has no Search Console property for ${project.domain}.`);
      }
      siteUrl = matched;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      throw new ServiceUnavailableException(`google-fetch-failed: could not list Search Console sites (${(err as Error).message})`);
    }

    const current = rangeDays(days);
    const previous = rangeDays(days, days);
    let byQuery: GscRow[];
    let byPage: GscRow[];
    let byDate: GscDateRow[];
    let prevRows: GscRow[];
    try {
      const api = webmasters.searchanalytics;
      const [q, p, d, prev] = await Promise.all([
        api.query({ siteUrl, requestBody: { ...current, dimensions: ['query'], rowLimit: 10 } }),
        api.query({ siteUrl, requestBody: { ...current, dimensions: ['page'], rowLimit: 10 } }),
        api.query({ siteUrl, requestBody: { ...current, dimensions: ['date'], rowLimit: 100 } }),
        api.query({ siteUrl, requestBody: { ...previous, rowLimit: 1000 } }),
      ]);
      byQuery = (q.data.rows ?? []).map((r) => this.gscRow(r.keys?.[0] ?? '(unknown)', r));
      byPage = (p.data.rows ?? []).map((r) => this.gscRow(r.keys?.[0] ?? '(unknown)', r));
      byDate = (d.data.rows ?? []).map((r) => ({ ...this.gscRow(r.keys?.[0] ?? '', r), date: r.keys?.[0] ?? '' }));
      prevRows = (prev.data.rows ?? []).map((r) => this.gscRow('', r));
    } catch (err) {
      throw new ServiceUnavailableException(`google-fetch-failed: Search Console query failed (${(err as Error).message})`);
    }

    return {
      siteUrl,
      days,
      totals: this.gscTotals(byDate),
      previousTotals: this.gscTotals(prevRows),
      byQuery,
      byPage,
      byDate,
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

  async getAnalytics(clientId: string, projectId: string, days: number): Promise<GaOverview> {
    const project = await this.assertProjectInClient(projectId, clientId);
    const oauth = await this.authorizedClientFor(clientId, PROVIDER_SCOPES.ga);
    const admin = google.analyticsadmin({ version: 'v1alpha', auth: oauth });
    const data = google.analyticsdata({ version: 'v1beta', auth: oauth });

    let propertyId: string;
    try {
      const matched = await this.matchGaProperty(admin, project.domain);
      if (!matched) {
        throw new NotFoundException(`google-no-property: this Google account has no Analytics property for ${project.domain}.`);
      }
      propertyId = matched;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      throw new ServiceUnavailableException(`google-fetch-failed: could not list Analytics properties (${(err as Error).message})`);
    }

    const current = rangeDays(days);
    const previous = rangeDays(days, days);
    try {
      const [cur, prev] = await Promise.all([
        data.properties.runReport({
          property: propertyId,
          requestBody: {
            dateRanges: [current],
            dimensions: [{ name: 'date' }],
            metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'screenPageViews' }],
            orderBys: [{ dimension: { dimensionName: 'date' } }],
            limit: '10000',
          },
        }),
        data.properties.runReport({
          property: propertyId,
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
      return { propertyId, days, totals: sum(byDate), previousTotals: prevTotals, byDate };
    } catch (err) {
      throw new ServiceUnavailableException(`google-fetch-failed: Analytics query failed (${(err as Error).message})`);
    }
  }

  /**
   * First property whose display name contains the domain stem, else the
   * first property, else null. (GA4 properties expose no website URL in
   * this API version, so the name is the only matchable signal.)
   */
  private async matchGaProperty(admin: ReturnType<typeof google.analyticsadmin>, domain: string): Promise<string | null> {
    const stem = normalizeHost(domain).split('.')[0];
    const summaries = await admin.accountSummaries.list({ pageSize: 200 });
    const candidates: Array<{ path: string; name: string }> = [];
    for (const account of summaries.data.accountSummaries ?? []) {
      for (const property of account.propertySummaries ?? []) {
        if (property.property) candidates.push({ path: property.property, name: property.displayName ?? '' });
      }
    }
    return (
      candidates.find((c) => c.name.toLowerCase().includes(stem))?.path ??
      candidates[0]?.path ??
      null
    );
  }

  // ─── Token handling ───────────────────────────────────────────────

  private encryptionKey(): Buffer {
    const hex = this.config.get<string>('GOOGLE_TOKEN_ENCRYPTION_KEY');
    const key = hex ? Buffer.from(hex, 'hex') : Buffer.alloc(0);
    if (key.length !== 32) {
      throw new ServiceUnavailableException('google-misconfigured: GOOGLE_TOKEN_ENCRYPTION_KEY must be 32 random bytes as hex — nothing was attempted');
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
      throw new ServiceUnavailableException('google-token-invalid: the stored Google credential is corrupt — reconnect the account');
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
      throw new NotFoundException('google-not-connected: this Google account is not connected — connect it first.');
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
