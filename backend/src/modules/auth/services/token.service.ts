import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AccessTokenPayload } from '../../../common/jwt/access-token-payload.js';

export interface OpaqueToken {
  /** The raw value — this is what gets emailed / returned to the client. Never stored. */
  raw: string;
  /** sha256 of raw — this is what's stored in the DB and matched against on lookup. */
  hash: string;
}

/**
 * Generates and verifies the two kinds of non-JWT tokens the login module
 * uses: refresh tokens and auth tokens (invite / resend / password-reset).
 * Both are opaque random strings; only their hash ever touches the DB.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /** Signs a short-lived JWT access token carrying the user's role and client id. */
  signAccessToken(payload: AccessTokenPayload): string {
    return this.jwtService.sign(payload);
  }

  /** Generates a new opaque token pair — the raw value to hand out, and its hash for DB storage/lookup. */
  generateOpaqueToken(): OpaqueToken {
    const raw = randomBytes(32).toString('base64url');
    return { raw, hash: this.hashOpaqueToken(raw) };
  }

  /** Hashes a raw opaque token the same way it's stored, for lookup by hash. */
  hashOpaqueToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** Expiry timestamp for a new refresh token, per REFRESH_TOKEN_TTL_DAYS. */
  refreshTokenExpiry(): Date {
    const days = this.configService.getOrThrow<number>('auth.refreshTokenTtlDays');
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  /** Expiry timestamp for a new invite/resend token, per INVITE_TOKEN_TTL_HOURS. */
  inviteTokenExpiry(): Date {
    const hours = this.configService.getOrThrow<number>('auth.inviteTokenTtlHours');
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  /** Expiry timestamp for a new password-reset token, per RESET_TOKEN_TTL_HOURS. */
  resetTokenExpiry(): Date {
    const hours = this.configService.getOrThrow<number>('auth.resetTokenTtlHours');
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }
}
