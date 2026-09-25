import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { ClientStatus, Role, UserStatus } from '../../../generated/prisma/enums.js';
import type { AccessTokenPayload } from '../../../common/jwt/access-token-payload.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../test/mocks/prisma.mock.js';
import { TeamService } from './team.service.js';
import { TokenService } from './token.service.js';

describe('TeamService', () => {
  let service: TeamService;
  let prisma: PrismaMock;
  let tokenService: {
    generateOpaqueToken: ReturnType<typeof vi.fn>;
    inviteTokenExpiry: ReturnType<typeof vi.fn>;
  };

  const admin: AccessTokenPayload = { sub: 'admin-1', role: Role.ADMIN, clientId: null };
  const poc: AccessTokenPayload = { sub: 'poc-1', role: Role.CLIENT_POC, clientId: 'client-1' };

  function buildTargetUser(overrides: Record<string, unknown> = {}) {
    return {
      id: 'target-1',
      email: 'target@test.com',
      role: Role.CLIENT_MEMBER,
      clientId: 'client-1',
      status: UserStatus.INVITED,
      ...overrides,
    };
  }

  beforeEach(async () => {
    prisma = createPrismaMock();

    tokenService = {
      generateOpaqueToken: vi.fn(() => ({ raw: 'raw-token', hash: 'hashed-token' })),
      inviteTokenExpiry: vi.fn(() => new Date(Date.now() + 60 * 60 * 1000)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TeamService,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: TokenService, useValue: tokenService },
      ],
    }).compile();

    service = moduleRef.get(TeamService);
  });

  describe('listClients', () => {
    it('maps the active POC onto each client', async () => {
      prisma.client.findMany.mockResolvedValue([
        {
          id: 'client-1',
          name: 'Acme',
          status: ClientStatus.ACTIVE,
          createdAt: new Date(),
          users: [{ email: 'poc@acme.com', status: UserStatus.ACTIVE }],
        },
        {
          id: 'client-2',
          name: 'No POC Co',
          status: ClientStatus.ACTIVE,
          createdAt: new Date(),
          users: [],
        },
      ]);

      const result = await service.listClients();

      expect(result[0].poc).toEqual({ email: 'poc@acme.com', status: UserStatus.ACTIVE });
      expect(result[1].poc).toBeNull();
    });
  });

  describe('listMembers', () => {
    it('throws BadRequest when the caller has no client context', async () => {
      await expect(service.listMembers(admin)).rejects.toThrow(BadRequestException);
    });

    it('lists users scoped to the caller\'s own client', async () => {
      prisma.user.findMany.mockResolvedValue([buildTargetUser({ id: 'poc-1', role: Role.CLIENT_POC })]);

      await service.listMembers(poc);

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { clientId: 'client-1', deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('createClientWithPoc', () => {
    it('creates the client, the POC user, and issues an invite', async () => {
      prisma.client.create.mockResolvedValue({ id: 'client-1', name: 'Acme' });
      prisma.user.create.mockResolvedValue(buildTargetUser({ id: 'poc-1', role: Role.CLIENT_POC }));

      const result = await service.createClientWithPoc(
        { name: 'Acme', pocEmail: 'POC@Acme.com' },
        'admin-1',
      );

      expect(prisma.client.create).toHaveBeenCalledWith({ data: { name: 'Acme', createdBy: 'admin-1' } });
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'poc@acme.com',
          role: Role.CLIENT_POC,
          clientId: 'client-1',
          status: UserStatus.INVITED,
          invitedBy: 'admin-1',
        },
      });
      expect(prisma.authToken.create).toHaveBeenCalled();
      expect(result.poc.email).toBe('target@test.com');
    });
  });

  describe('inviteTeamMember', () => {
    it('throws BadRequest when the caller has no client context', async () => {
      await expect(service.inviteTeamMember({ email: 'a@b.com' }, admin)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates a CLIENT_MEMBER in the caller\'s client and issues an invite', async () => {
      prisma.user.create.mockResolvedValue(buildTargetUser());

      await service.inviteTeamMember({ email: 'Member@Acme.com' }, poc);

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'member@acme.com',
          role: Role.CLIENT_MEMBER,
          clientId: 'client-1',
          status: UserStatus.INVITED,
          invitedBy: 'poc-1',
        },
      });
      expect(prisma.authToken.create).toHaveBeenCalled();
    });
  });

  describe('resendInvite', () => {
    it('throws NotFound when the target user does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.resendInvite('missing', poc)).rejects.toThrow(NotFoundException);
    });

    it('throws Forbidden when a non-admin targets a user outside their own client', async () => {
      prisma.user.findFirst.mockResolvedValue(buildTargetUser({ clientId: 'other-client' }));
      await expect(service.resendInvite('target-1', poc)).rejects.toThrow(ForbiddenException);
    });

    it('allows ADMIN to act across clients', async () => {
      prisma.user.findFirst.mockResolvedValue(buildTargetUser({ clientId: 'other-client' }));
      await expect(service.resendInvite('target-1', admin)).resolves.toEqual({ success: true });
    });

    it('throws BadRequest if the target already completed onboarding', async () => {
      prisma.user.findFirst.mockResolvedValue(buildTargetUser({ status: UserStatus.ACTIVE }));
      await expect(service.resendInvite('target-1', poc)).rejects.toThrow(BadRequestException);
    });

    it('issues a fresh invite for a still-INVITED user in the caller\'s client', async () => {
      prisma.user.findFirst.mockResolvedValue(buildTargetUser());
      const result = await service.resendInvite('target-1', poc);
      expect(prisma.authToken.create).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });
  });

  describe('disableUser', () => {
    it('throws BadRequest when targeting your own account', async () => {
      prisma.user.findFirst.mockResolvedValue(buildTargetUser({ id: 'poc-1', clientId: 'client-1' }));
      await expect(service.disableUser('poc-1', poc)).rejects.toThrow(BadRequestException);
    });

    it('disables the target and revokes their active sessions', async () => {
      prisma.user.findFirst.mockResolvedValue(buildTargetUser());

      await service.disableUser('target-1', poc);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'target-1' },
        data: { status: UserStatus.DISABLED },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'target-1', revokedAt: null, deletedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('enableUser', () => {
    it('throws BadRequest if the user is not currently disabled', async () => {
      prisma.user.findFirst.mockResolvedValue(buildTargetUser({ status: UserStatus.ACTIVE }));
      await expect(service.enableUser('target-1', poc)).rejects.toThrow(BadRequestException);
    });

    it('re-activates a disabled user and resets lockout state', async () => {
      prisma.user.findFirst.mockResolvedValue(buildTargetUser({ status: UserStatus.DISABLED }));

      await service.enableUser('target-1', poc);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'target-1' },
        data: { status: UserStatus.ACTIVE, failedAttempts: 0, lockedUntil: null },
      });
    });
  });

  describe('suspendClient', () => {
    it('throws NotFound for an unknown client', async () => {
      prisma.client.findFirst.mockResolvedValue(null);
      await expect(service.suspendClient('missing')).rejects.toThrow(NotFoundException);
    });

    it('suspends the client and bulk-revokes its users\' sessions', async () => {
      prisma.client.findFirst.mockResolvedValue({ id: 'client-1', status: ClientStatus.ACTIVE });

      await service.suspendClient('client-1');

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 'client-1' },
        data: { status: ClientStatus.SUSPENDED },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { user: { clientId: 'client-1' }, revokedAt: null, deletedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('activateClient', () => {
    it('throws NotFound for an unknown client', async () => {
      prisma.client.findFirst.mockResolvedValue(null);
      await expect(service.activateClient('missing')).rejects.toThrow(NotFoundException);
    });

    it('reactivates a suspended client', async () => {
      prisma.client.findFirst.mockResolvedValue({ id: 'client-1', status: ClientStatus.SUSPENDED });

      await service.activateClient('client-1');

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 'client-1' },
        data: { status: ClientStatus.ACTIVE },
      });
    });
  });
});
