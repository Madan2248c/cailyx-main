import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { AuthTokenType, ClientStatus, Role, UserStatus } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../test/mocks/prisma.mock.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaMock;
  let passwordService: { hash: ReturnType<typeof vi.fn>; verify: ReturnType<typeof vi.fn> };
  let tokenService: {
    hashOpaqueToken: ReturnType<typeof vi.fn>;
    generateOpaqueToken: ReturnType<typeof vi.fn>;
    signAccessToken: ReturnType<typeof vi.fn>;
    refreshTokenExpiry: ReturnType<typeof vi.fn>;
    inviteTokenExpiry: ReturnType<typeof vi.fn>;
    resetTokenExpiry: ReturnType<typeof vi.fn>;
  };

  const meta = { userAgent: 'test-agent', ipAddress: '127.0.0.1' };

  function buildUser(overrides: Record<string, unknown> = {}) {
    return {
      id: 'user-1',
      email: 'user@test.com',
      passwordHash: 'hashed-pw',
      role: Role.CLIENT_POC,
      clientId: 'client-1',
      status: UserStatus.ACTIVE,
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      client: {
        id: 'client-1',
        name: 'Test Co',
        status: ClientStatus.ACTIVE,
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
      ...overrides,
    };
  }

  beforeEach(async () => {
    prisma = createPrismaMock();

    passwordService = { hash: vi.fn(), verify: vi.fn() };

    tokenService = {
      hashOpaqueToken: vi.fn((raw: string) => `hashed:${raw}`),
      generateOpaqueToken: vi.fn(() => ({ raw: 'raw-token', hash: 'hashed-token' })),
      signAccessToken: vi.fn(() => 'signed.jwt.token'),
      refreshTokenExpiry: vi.fn(() => new Date(Date.now() + 60 * 60 * 1000)),
      inviteTokenExpiry: vi.fn(() => new Date(Date.now() + 60 * 60 * 1000)),
      resetTokenExpiry: vi.fn(() => new Date(Date.now() + 60 * 60 * 1000)),
    };

    const configService = {
      getOrThrow: vi.fn((key: string) => {
        if (key === 'auth.loginMaxAttempts') return 5;
        if (key === 'auth.loginLockoutMinutes') return 15;
        throw new Error(`Unexpected config key in test: ${key}`);
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: PasswordService, useValue: passwordService },
        { provide: TokenService, useValue: tokenService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('login', () => {
    it('throws Unauthorized when no user matches the email', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.login({ email: 'x@x.com', password: 'pw' }, meta)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws Unauthorized while the account is locked', async () => {
      prisma.user.findFirst.mockResolvedValue(
        buildUser({ lockedUntil: new Date(Date.now() + 100_000) }),
      );

      await expect(service.login({ email: 'x@x.com', password: 'pw' }, meta)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws Forbidden for a disabled account', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser({ status: UserStatus.DISABLED }));

      await expect(service.login({ email: 'x@x.com', password: 'pw' }, meta)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws Forbidden for an account that has not completed onboarding', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser({ status: UserStatus.INVITED }));

      await expect(service.login({ email: 'x@x.com', password: 'pw' }, meta)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws Forbidden when the user\'s client is suspended', async () => {
      const user = buildUser();
      prisma.user.findFirst.mockResolvedValue({
        ...user,
        client: { ...user.client, status: ClientStatus.SUSPENDED },
      });

      await expect(service.login({ email: 'x@x.com', password: 'pw' }, meta)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('treats a null passwordHash as invalid credentials without calling verify', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser({ passwordHash: null }));

      await expect(service.login({ email: 'x@x.com', password: 'pw' }, meta)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(passwordService.verify).not.toHaveBeenCalled();
    });

    it('increments failedAttempts on a wrong password', async () => {
      const user = buildUser({ failedAttempts: 2 });
      prisma.user.findFirst.mockResolvedValue(user);
      passwordService.verify.mockResolvedValue(false);

      await expect(
        service.login({ email: 'x@x.com', password: 'wrong' }, meta),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { failedAttempts: 3 },
      });
    });

    it('locks the account once the failure count reaches the configured max, resetting the counter', async () => {
      const user = buildUser({ failedAttempts: 4 }); // 5th failure hits loginMaxAttempts=5
      prisma.user.findFirst.mockResolvedValue(user);
      passwordService.verify.mockResolvedValue(false);

      await expect(
        service.login({ email: 'x@x.com', password: 'wrong' }, meta),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { failedAttempts: 0, lockedUntil: expect.any(Date) },
      });
    });

    it('normalizes email casing, resets lockout state, and issues a session on success', async () => {
      const user = buildUser();
      prisma.user.findFirst.mockResolvedValue(user);
      passwordService.verify.mockResolvedValue(true);
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const session = await service.login({ email: 'USER@Test.com', password: 'correct' }, meta);

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { email: 'user@test.com', deletedAt: null },
        include: { client: true },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: expect.any(Date) },
      });
      expect(session).toEqual({
        accessToken: 'signed.jwt.token',
        refreshToken: 'raw-token',
        user: { id: user.id, email: user.email, role: user.role, clientId: user.clientId, status: user.status },
      });
    });
  });

  describe('refresh', () => {
    it('throws Unauthorized when the token is unknown', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue(null);

      await expect(service.refresh({ refreshToken: 'raw' }, meta)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('revokes every session for the user when a revoked token is reused', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 100_000),
      });

      await expect(service.refresh({ refreshToken: 'raw' }, meta)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null, deletedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('throws Unauthorized for an expired token', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.refresh({ refreshToken: 'raw' }, meta)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws Forbidden if the user is no longer active', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 100_000),
      });
      prisma.user.findFirst.mockResolvedValue(buildUser({ status: UserStatus.DISABLED }));

      await expect(service.refresh({ refreshToken: 'raw' }, meta)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rotates the token: revokes the old one and links it to the new one', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue({
        id: 'old-rt',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 100_000),
      });
      prisma.user.findFirst.mockResolvedValue(buildUser());
      prisma.refreshToken.create.mockResolvedValue({ id: 'new-rt' });

      const session = await service.refresh({ refreshToken: 'raw' }, meta);

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'old-rt' },
        data: { revokedAt: expect.any(Date), replacedById: 'new-rt' },
      });
      expect(session.accessToken).toBe('signed.jwt.token');
    });
  });

  describe('logout', () => {
    it('revokes the matching refresh token and always reports success', async () => {
      const result = await service.logout({ refreshToken: 'raw' });

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: 'hashed:raw', deletedAt: null, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('acceptInvite', () => {
    it('throws BadRequest when the token is missing or expired', async () => {
      prisma.authToken.findFirst.mockResolvedValue(null);

      await expect(
        service.acceptInvite({ token: 'raw', password: 'newpass123' }, meta),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws Forbidden if the account was disabled after being invited', async () => {
      prisma.authToken.findFirst.mockResolvedValue({
        id: 'at-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 100_000),
      });
      prisma.user.findFirst.mockResolvedValue(buildUser({ status: UserStatus.DISABLED }));

      await expect(
        service.acceptInvite({ token: 'raw', password: 'newpass123' }, meta),
      ).rejects.toThrow(ForbiddenException);
    });

    it('sets the password, activates the account, consumes the token, and issues a session', async () => {
      prisma.authToken.findFirst.mockResolvedValue({
        id: 'at-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 100_000),
      });
      prisma.user.findFirst.mockResolvedValue(buildUser({ status: UserStatus.INVITED }));
      passwordService.hash.mockResolvedValue('new-hash');
      prisma.user.update.mockResolvedValue(buildUser({ status: UserStatus.ACTIVE }));
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const session = await service.acceptInvite({ token: 'raw', password: 'newpass123' }, meta);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          passwordHash: 'new-hash',
          status: UserStatus.ACTIVE,
          failedAttempts: 0,
          lockedUntil: null,
          lastLoginAt: expect.any(Date),
        },
        include: { client: true },
      });
      expect(prisma.authToken.update).toHaveBeenCalledWith({
        where: { id: 'at-1' },
        data: { consumedAt: expect.any(Date) },
      });
      expect(session.accessToken).toBe('signed.jwt.token');
    });
  });

  describe('isInviteTokenValid / isResetTokenValid', () => {
    it('returns false when no matching token exists', async () => {
      prisma.authToken.findFirst.mockResolvedValue(null);
      expect(await service.isInviteTokenValid('raw')).toBe(false);
    });

    it('returns false for an already-expired token', async () => {
      prisma.authToken.findFirst.mockResolvedValue({ expiresAt: new Date(Date.now() - 1000) });
      expect(await service.isInviteTokenValid('raw')).toBe(false);
    });

    it('returns true for a valid, unexpired token', async () => {
      prisma.authToken.findFirst.mockResolvedValue({ expiresAt: new Date(Date.now() + 100_000) });
      expect(await service.isInviteTokenValid('raw')).toBe(true);
    });

    it('isResetTokenValid queries for the PASSWORD_RESET type specifically', async () => {
      prisma.authToken.findFirst.mockResolvedValue({ expiresAt: new Date(Date.now() + 100_000) });

      expect(await service.isResetTokenValid('raw')).toBe(true);
      expect(prisma.authToken.findFirst).toHaveBeenCalledWith({
        where: {
          tokenHash: 'hashed:raw',
          deletedAt: null,
          consumedAt: null,
          type: AuthTokenType.PASSWORD_RESET,
        },
      });
    });
  });

  describe('forgotPassword', () => {
    it('returns the same generic message when no user matches, without creating a token', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const result = await service.forgotPassword({ email: 'ghost@test.com' });

      expect(result).toEqual({ message: 'If that email exists, a reset link has been sent.' });
      expect(prisma.authToken.create).not.toHaveBeenCalled();
    });

    it('soft-deletes prior unconsumed reset tokens and issues a new one for a real user', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser());

      const result = await service.forgotPassword({ email: 'user@test.com' });

      expect(prisma.authToken.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          type: AuthTokenType.PASSWORD_RESET,
          consumedAt: null,
          deletedAt: null,
        },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.authToken.create).toHaveBeenCalled();
      expect(result).toEqual({ message: 'If that email exists, a reset link has been sent.' });
    });
  });

  describe('resetPassword', () => {
    it('throws BadRequest for an invalid/expired/consumed token', async () => {
      prisma.authToken.findFirst.mockResolvedValue(null);

      await expect(
        service.resetPassword({ token: 'raw', password: 'newpass123' }, meta),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets the new password, revokes every existing session, and issues a fresh one', async () => {
      prisma.authToken.findFirst.mockResolvedValue({
        id: 'at-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 100_000),
      });
      prisma.user.findFirst.mockResolvedValue(buildUser());
      passwordService.hash.mockResolvedValue('new-hash');
      prisma.user.update.mockResolvedValue(buildUser());
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const session = await service.resetPassword({ token: 'raw', password: 'newpass123' }, meta);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null, deletedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.authToken.update).toHaveBeenCalledWith({
        where: { id: 'at-1' },
        data: { consumedAt: expect.any(Date) },
      });
      expect(session.accessToken).toBe('signed.jwt.token');
    });
  });
});
