import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { TokenService } from './token.service.js';

describe('TokenService', () => {
  let service: TokenService;
  let jwtService: { sign: ReturnType<typeof vi.fn> };
  let configValues: Record<string, number | string>;

  beforeEach(async () => {
    jwtService = { sign: vi.fn(() => 'signed.jwt.token') };
    configValues = {
      'auth.refreshTokenTtlDays': 30,
      'auth.inviteTokenTtlHours': 72,
      'auth.resetTokenTtlHours': 1,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: { getOrThrow: vi.fn((key: string) => configValues[key]) },
        },
      ],
    }).compile();

    service = moduleRef.get(TokenService);
  });

  it('signAccessToken delegates to JwtService.sign with the given payload', () => {
    const payload = { sub: 'user-1', role: 'ADMIN' as const, clientId: null };
    const token = service.signAccessToken(payload);

    expect(jwtService.sign).toHaveBeenCalledWith(payload);
    expect(token).toBe('signed.jwt.token');
  });

  it('generateOpaqueToken returns a raw value whose sha256 matches the hash', () => {
    const { raw, hash } = service.generateOpaqueToken();
    expect(hash).toBe(createHash('sha256').update(raw).digest('hex'));
  });

  it('generateOpaqueToken produces a different value on every call', () => {
    const a = service.generateOpaqueToken();
    const b = service.generateOpaqueToken();
    expect(a.raw).not.toBe(b.raw);
  });

  it('hashOpaqueToken is deterministic for the same input', () => {
    expect(service.hashOpaqueToken('same-input')).toBe(service.hashOpaqueToken('same-input'));
  });

  it('refreshTokenExpiry is roughly REFRESH_TOKEN_TTL_DAYS from now', () => {
    const expiry = service.refreshTokenExpiry();
    const expectedMs = 30 * 24 * 60 * 60 * 1000;
    expect(expiry.getTime() - Date.now()).toBeGreaterThan(expectedMs - 5000);
    expect(expiry.getTime() - Date.now()).toBeLessThanOrEqual(expectedMs);
  });

  it('inviteTokenExpiry is roughly INVITE_TOKEN_TTL_HOURS from now', () => {
    const expiry = service.inviteTokenExpiry();
    const expectedMs = 72 * 60 * 60 * 1000;
    expect(expiry.getTime() - Date.now()).toBeGreaterThan(expectedMs - 5000);
    expect(expiry.getTime() - Date.now()).toBeLessThanOrEqual(expectedMs);
  });

  it('resetTokenExpiry is roughly RESET_TOKEN_TTL_HOURS from now', () => {
    const expiry = service.resetTokenExpiry();
    const expectedMs = 1 * 60 * 60 * 1000;
    expect(expiry.getTime() - Date.now()).toBeGreaterThan(expectedMs - 5000);
    expect(expiry.getTime() - Date.now()).toBeLessThanOrEqual(expectedMs);
  });
});
