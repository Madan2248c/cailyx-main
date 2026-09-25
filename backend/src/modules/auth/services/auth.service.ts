import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthTokenType, ClientStatus, UserStatus } from '../../../generated/prisma/enums.js';
import type { ClientModel, UserModel } from '../../../generated/prisma/models.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { AcceptInviteDto } from '../dto/accept-invite.dto.js';
import type { ForgotPasswordDto } from '../dto/forgot-password.dto.js';
import type { LoginDto } from '../dto/login.dto.js';
import type { RefreshTokenDto } from '../dto/refresh-token.dto.js';
import type { ResetPasswordDto } from '../dto/reset-password.dto.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

type UserWithClient = UserModel & { client: ClientModel | null };

export interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    role: UserModel['role'];
    clientId: string | null;
    status: UserModel['status'];
  };
}

const INVALID_CREDENTIALS = 'Invalid email or password';
const GENERIC_INVITE_ERROR = 'This invite link is invalid or has expired.';
const GENERIC_RESET_ERROR = 'This reset link is invalid or has expired.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly configService: ConfigService,
  ) {}

  /** Verifies credentials, enforces lockout/status/client-suspension rules, and issues a new session. */
  async login(dto: LoginDto, meta: RequestMeta): Promise<Session> {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      include: { client: true },
    });

    if (!user) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    this.assertLoginAllowed(user);

    const passwordValid = user.passwordHash
      ? await this.passwordService.verify(user.passwordHash, dto.password)
      : false;

    if (!passwordValid) {
      await this.registerFailedAttempt(user.id, user.failedAttempts);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    return this.issueSession(user, meta);
  }

  /** Rotates a refresh token into a new session; reusing an already-rotated token revokes all of that user's sessions. */
  async refresh(dto: RefreshTokenDto, meta: RequestMeta): Promise<Session> {
    const tokenHash = this.tokenService.hashOpaqueToken(dto.refreshToken);
    const existing = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, deletedAt: null },
    });

    if (!existing) {
      throw new UnauthorizedException('Invalid session');
    }

    if (existing.revokedAt) {
      // Reuse of an already-rotated/revoked token is a strong signal of a
      // stolen token — kill every session this user has as a precaution.
      await this.revokeAllSessions(existing.userId);
      throw new UnauthorizedException('Session revoked. Please log in again.');
    }

    if (existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired. Please log in again.');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: existing.userId, deletedAt: null },
      include: { client: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid session');
    }

    this.assertActiveSession(user);

    const session = await this.issueSession(user, meta, existing.id);
    return session;
  }

  /** Revokes the given refresh token. Idempotent — succeeds even if the token was already revoked or unknown. */
  async logout(dto: RefreshTokenDto): Promise<{ success: true }> {
    const tokenHash = this.tokenService.hashOpaqueToken(dto.refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, deletedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  /** Consumes an invite/resend token, sets the user's password, activates the account, and logs them in. */
  async acceptInvite(dto: AcceptInviteDto, meta: RequestMeta): Promise<Session> {
    const tokenHash = this.tokenService.hashOpaqueToken(dto.token);
    const authToken = await this.prisma.authToken.findFirst({
      where: {
        tokenHash,
        deletedAt: null,
        consumedAt: null,
        type: { in: [AuthTokenType.INITIAL_INVITE, AuthTokenType.RESEND_INVITE] },
      },
    });

    if (!authToken || authToken.expiresAt < new Date()) {
      throw new BadRequestException(GENERIC_INVITE_ERROR);
    }

    const user = await this.prisma.user.findFirst({
      where: { id: authToken.userId, deletedAt: null },
    });

    if (!user) {
      throw new BadRequestException(GENERIC_INVITE_ERROR);
    }

    if (user.status === UserStatus.DISABLED) {
      throw new ForbiddenException('This account has been disabled.');
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        status: UserStatus.ACTIVE,
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
      include: { client: true },
    });

    await this.prisma.authToken.update({
      where: { id: authToken.id },
      data: { consumedAt: new Date() },
    });

    return this.issueSession(updatedUser, meta);
  }

  /**
   * Read-only check so the frontend can tell a used/expired invite link
   * apart from a fresh one *before* rendering the "set your password" form
   * — without this, a link opened twice looks like it still works right up
   * until submission.
   */
  async isInviteTokenValid(rawToken: string): Promise<boolean> {
    const tokenHash = this.tokenService.hashOpaqueToken(rawToken);
    const authToken = await this.prisma.authToken.findFirst({
      where: {
        tokenHash,
        deletedAt: null,
        consumedAt: null,
        type: { in: [AuthTokenType.INITIAL_INVITE, AuthTokenType.RESEND_INVITE] },
      },
    });
    return Boolean(authToken) && authToken!.expiresAt > new Date();
  }

  /** Same idea as isInviteTokenValid, for the password-reset link. */
  async isResetTokenValid(rawToken: string): Promise<boolean> {
    const tokenHash = this.tokenService.hashOpaqueToken(rawToken);
    const authToken = await this.prisma.authToken.findFirst({
      where: { tokenHash, deletedAt: null, consumedAt: null, type: AuthTokenType.PASSWORD_RESET },
    });
    return Boolean(authToken) && authToken!.expiresAt > new Date();
  }

  /** Issues a password-reset token for an active user; always returns the same generic message to prevent account enumeration. */
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null, status: UserStatus.ACTIVE },
    });

    if (user) {
      await this.prisma.authToken.updateMany({
        where: {
          userId: user.id,
          type: AuthTokenType.PASSWORD_RESET,
          consumedAt: null,
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      });

      const token = this.tokenService.generateOpaqueToken();
      await this.prisma.authToken.create({
        data: {
          userId: user.id,
          tokenHash: token.hash,
          type: AuthTokenType.PASSWORD_RESET,
          expiresAt: this.tokenService.resetTokenExpiry(),
        },
      });

      // TODO: send this via the email module once it exists. Logged for now
      // so the flow is testable end-to-end without email infrastructure.
      this.logger.debug(`Password reset token for ${email}: ${token.raw}`);
    }

    // Always the same response, whether or not the email exists — this
    // endpoint must not be usable to enumerate accounts.
    return { message: 'If that email exists, a reset link has been sent.' };
  }

  /** Consumes a password-reset token, sets the new password, revokes every existing session, and logs the user in. */
  async resetPassword(dto: ResetPasswordDto, meta: RequestMeta): Promise<Session> {
    const tokenHash = this.tokenService.hashOpaqueToken(dto.token);
    const authToken = await this.prisma.authToken.findFirst({
      where: {
        tokenHash,
        deletedAt: null,
        consumedAt: null,
        type: AuthTokenType.PASSWORD_RESET,
      },
    });

    if (!authToken || authToken.expiresAt < new Date()) {
      throw new BadRequestException(GENERIC_RESET_ERROR);
    }

    const user = await this.prisma.user.findFirst({
      where: { id: authToken.userId, deletedAt: null },
    });

    if (!user || user.status === UserStatus.DISABLED) {
      throw new BadRequestException(GENERIC_RESET_ERROR);
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, failedAttempts: 0, lockedUntil: null },
      include: { client: true },
    });

    await this.prisma.authToken.update({
      where: { id: authToken.id },
      data: { consumedAt: new Date() },
    });

    // A password reset invalidates every existing session, not just the
    // device the reset happened on.
    await this.revokeAllSessions(user.id);

    return this.issueSession(updatedUser, meta);
  }

  private assertLoginAllowed(user: UserWithClient): void {
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account temporarily locked. Try again later.');
    }

    if (user.status === UserStatus.DISABLED) {
      throw new ForbiddenException('This account has been disabled.');
    }

    if (user.status === UserStatus.INVITED) {
      throw new ForbiddenException(
        'Account not yet activated. Check your email for the invite link.',
      );
    }

    if (user.client && user.client.status === ClientStatus.SUSPENDED) {
      throw new ForbiddenException('Access for your organization has been suspended.');
    }
  }

  private assertActiveSession(user: UserWithClient): void {
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('This account is not active.');
    }

    if (user.client && user.client.status === ClientStatus.SUSPENDED) {
      throw new ForbiddenException('Access for your organization has been suspended.');
    }
  }

  private async registerFailedAttempt(userId: string, currentAttempts: number): Promise<void> {
    const maxAttempts = this.configService.getOrThrow<number>('auth.loginMaxAttempts');
    const lockoutMinutes = this.configService.getOrThrow<number>('auth.loginLockoutMinutes');
    const attempts = currentAttempts + 1;

    if (attempts >= maxAttempts) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          failedAttempts: 0,
          lockedUntil: new Date(Date.now() + lockoutMinutes * 60 * 1000),
        },
      });
      return;
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { failedAttempts: attempts },
    });
  }

  private async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null, deletedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueSession(
    user: UserWithClient,
    meta: RequestMeta,
    replacesTokenId?: string,
  ): Promise<Session> {
    const accessToken = this.tokenService.signAccessToken({
      sub: user.id,
      role: user.role,
      clientId: user.clientId,
    });
    const refreshToken = this.tokenService.generateOpaqueToken();

    const created = await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshToken.hash,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
        expiresAt: this.tokenService.refreshTokenExpiry(),
      },
    });

    if (replacesTokenId) {
      await this.prisma.refreshToken.update({
        where: { id: replacesTokenId },
        data: { revokedAt: new Date(), replacedById: created.id },
      });
    }

    return {
      accessToken,
      refreshToken: refreshToken.raw,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        clientId: user.clientId,
        status: user.status,
      },
    };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
