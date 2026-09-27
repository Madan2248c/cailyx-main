import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../test/mocks/prisma.mock.js';
import { matchGscSite, normalizeHost, GoogleService } from './google.service.js';
import { GSC_SCOPE, GA_SCOPE } from './google.types.js';

const KEY_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function config(values: Record<string, string>): ConfigService {
  return { get: (key: string, fallback?: unknown) => values[key] ?? fallback } as unknown as ConfigService;
}

const FULL = {
  GOOGLE_CLIENT_ID: 'cid',
  GOOGLE_CLIENT_SECRET: 'csecret',
  GOOGLE_TOKEN_ENCRYPTION_KEY: KEY_HEX,
};

describe('google host matching', () => {
  it('normalizes urls, sc-domains, www, and case', () => {
    expect(normalizeHost('https://WWW.Acme.com/pricing?a=1')).toBe('acme.com');
    expect(normalizeHost('sc-domain:acme.com')).toBe('acme.com');
    expect(normalizeHost('acme.com.')).toBe('acme.com');
  });

  it('matches exact, subdomain, and parent domains — never strangers', () => {
    const sites = [{ siteUrl: 'sc-domain:acme.com' }, { siteUrl: 'https://blog.acme.com/' }, { siteUrl: 'https://other.io/' }];
    expect(matchGscSite(sites, 'acme.com')).toBe('sc-domain:acme.com');
    expect(matchGscSite(sites, 'blog.acme.com')).toBe('https://blog.acme.com/');
    expect(matchGscSite(sites, 'evilacme.com')).toBeNull();
    expect(matchGscSite([], 'acme.com')).toBeNull();
  });
});

describe('GoogleService', () => {
  let service: GoogleService;
  let prisma: PrismaMock;
  let jwt: { signAsync: ReturnType<typeof vi.fn>; verifyAsync: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = createPrismaMock();
    jwt = { signAsync: vi.fn(async () => 'signed-state'), verifyAsync: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GoogleService,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: ConfigService, useValue: config(FULL) },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();

    service = moduleRef.get(GoogleService);
  });

  describe('token crypto', () => {
    it('round-trips a refresh token and rejects tampering', () => {
      const packed = service.encrypt('refresh-token-abc');
      expect(service.decrypt(packed)).toBe('refresh-token-abc');
      expect(packed).not.toContain('refresh-token-abc');
      expect(() => service.decrypt(packed.slice(0, -2) + 'ff')).toThrow(/google-token-invalid/);
    });

    it('refuses a malformed encryption key instead of silently weakening crypto', async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          GoogleService,
          { provide: PrismaService, useValue: asPrismaService(prisma) },
          { provide: ConfigService, useValue: config({ ...FULL, GOOGLE_TOKEN_ENCRYPTION_KEY: 'short' }) },
          { provide: JwtService, useValue: jwt },
        ],
      }).compile();
      const weak = moduleRef.get(GoogleService);

      expect(() => weak.encrypt('x')).toThrow(/google-misconfigured/);
    });
  });

  describe('guards', () => {
    it('connectUrl 503s when unconfigured and 404s for unknown clients', async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          GoogleService,
          { provide: PrismaService, useValue: asPrismaService(prisma) },
          { provide: ConfigService, useValue: config({}) },
          { provide: JwtService, useValue: jwt },
        ],
      }).compile();
      const unconfigured = moduleRef.get(GoogleService);

      await expect(unconfigured.connectUrl('client-1', 'gsc')).rejects.toThrow(/google-unconfigured/);
    });

    it('connectUrl returns a Google consent URL carrying the signed state', async () => {
      prisma.client.findFirst.mockResolvedValue({ id: 'client-1' });

      const { url } = await service.connectUrl('client-1', 'gsc');

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url).toContain(encodeURIComponent(GSC_SCOPE));
      expect(url).toContain('state=signed-state');
      expect(jwt.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'google-oauth', clientId: 'client-1', provider: 'gsc' }),
        { expiresIn: '10m' },
      );
    });

    it('overview calls 404 when no connection or scope exists — never touches Google', async () => {
      prisma.project.findFirst.mockResolvedValue({ id: 'project-1', domain: 'acme.com' });
      prisma.googleConnection.findUnique.mockResolvedValue(null);

      await expect(service.getSearchConsole('client-1', 'project-1', 28)).rejects.toThrow(/google-not-connected/);
      await expect(service.getAnalytics('client-1', 'project-1', 28)).rejects.toThrow(/google-not-connected/);

      prisma.googleConnection.findUnique.mockResolvedValue({ scopes: [GSC_SCOPE] });
      await expect(service.getAnalytics('client-1', 'project-1', 28)).rejects.toThrow(/google-not-connected/);
    });
  });

  describe('status', () => {
    it('reports per-provider linkage from stored scopes', async () => {
      prisma.googleConnection.findUnique.mockResolvedValue({ scopes: [GSC_SCOPE] });

      await expect(service.getStatus('client-1')).resolves.toEqual({
        gsc: { connected: true },
        ga: { connected: false },
      });
    });

    it('reports all-false with no row', async () => {
      prisma.googleConnection.findUnique.mockResolvedValue(null);

      await expect(service.getStatus('client-1')).resolves.toEqual({
        gsc: { connected: false },
        ga: { connected: false },
      });
    });
  });

  describe('disconnect', () => {
    it('is a no-op success with no row, and deletes otherwise', async () => {
      prisma.googleConnection.findUnique.mockResolvedValue(null);
      await expect(service.disconnect('client-1')).resolves.toEqual({ success: true });
      expect(prisma.googleConnection.delete).not.toHaveBeenCalled();
    });
  });

  it('uses the GA scope constant for GA checks (no silent scope drift)', () => {
    expect(GA_SCOPE).toBe('https://www.googleapis.com/auth/analytics.readonly');
  });
});
