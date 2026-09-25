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
    it('maps the active POC and seat usage onto each client', async () => {
      prisma.client.findMany.mockResolvedValue([
        {
          id: 'client-1',
          name: 'Acme',
          status: ClientStatus.ACTIVE,
          seatLimit: 5,
          createdAt: new Date(),
          users: [{ email: 'poc@acme.com', status: UserStatus.ACTIVE }],
          _count: { users: 3 },
        },
        {
          id: 'client-2',
          name: 'No POC Co',
          status: ClientStatus.ACTIVE,
          seatLimit: 1,
          createdAt: new Date(),
          users: [],
          _count: { users: 0 },
        },
      ]);

      const result = await service.listClients();

      expect(result[0].poc).toEqual({ email: 'poc@acme.com', status: UserStatus.ACTIVE });
      expect(result[0].seatLimit).toBe(5);
      expect(result[0].seatsUsed).toBe(3);
      expect(result[1].poc).toBeNull();
    });
  });

  describe('listMembers', () => {
    it('throws BadRequest when the caller has no client context', async () => {
      await expect(service.listMembers(admin)).rejects.toThrow(BadRequestException);
    });

    it('lists users scoped to the caller\'s own client, with seat usage', async () => {
      prisma.client.findFirst.mockResolvedValue({ id: 'client-1', seatLimit: 5 });
      prisma.user.findMany.mockResolvedValue([
        buildTargetUser({ id: 'poc-1', role: Role.CLIENT_POC, status: UserStatus.ACTIVE }),
        buildTargetUser({ id: 'target-1', status: UserStatus.DISABLED }),
      ]);

      const result = await service.listMembers(poc);

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { clientId: 'client-1', deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      expect(result.seatLimit).toBe(5);
      // Only the ACTIVE user occupies a seat; the DISABLED one doesn't.
      expect(result.seatsUsed).toBe(1);
      expect(result.members).toHaveLength(2);
    });
  });

  describe('createClientWithPoc', () => {
    it('creates the client (with the given seat limit), the POC user, and issues an invite', async () => {
      prisma.client.create.mockResolvedValue({ id: 'client-1', name: 'Acme', seatLimit: 3 });
      prisma.user.create.mockResolvedValue(buildTargetUser({ id: 'poc-1', role: Role.CLIENT_POC }));

      const result = await service.createClientWithPoc(
        { name: 'Acme', pocEmail: 'POC@Acme.com', seatLimit: 3 },
        'admin-1',
      );

      expect(prisma.client.create).toHaveBeenCalledWith({
        data: { name: 'Acme', createdBy: 'admin-1', seatLimit: 3 },
      });
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

    it('passes seatLimit through as undefined when omitted, letting the DB default apply', async () => {
      prisma.client.create.mockResolvedValue({ id: 'client-1', name: 'Acme', seatLimit: 1 });
      prisma.user.create.mockResolvedValue(buildTargetUser({ id: 'poc-1', role: Role.CLIENT_POC }));

      await service.createClientWithPoc({ name: 'Acme', pocEmail: 'poc@acme.com' }, 'admin-1');

      expect(prisma.client.create).toHaveBeenCalledWith({
        data: { name: 'Acme', createdBy: 'admin-1', seatLimit: undefined },
      });
    });
  });

  describe('updateSeatLimit', () => {
    it('throws NotFound for an unknown client', async () => {
      prisma.client.findFirst.mockResolvedValue(null);
      await expect(service.updateSeatLimit('missing', { seatLimit: 5 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updates the seat limit', async () => {
      prisma.client.findFirst.mockResolvedValue({ id: 'client-1', seatLimit: 1 });

      const result = await service.updateSeatLimit('client-1', { seatLimit: 10 });

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 'client-1' },
        data: { seatLimit: 10 },
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('inviteTeamMember', () => {
    it('throws BadRequest when the caller has no client context', async () => {
      await expect(service.inviteTeamMember({ email: 'a@b.com' }, admin)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequest when the client has no free seats', async () => {
      prisma.client.findFirst.mockResolvedValue({ id: 'client-1', seatLimit: 2 });
      prisma.user.count.mockResolvedValue(2);

      await expect(service.inviteTeamMember({ email: 'a@b.com' }, poc)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('creates a CLIENT_MEMBER when a seat is free, and issues an invite', async () => {
      prisma.client.findFirst.mockResolvedValue({ id: 'client-1', seatLimit: 5 });
      prisma.user.count.mockResolvedValue(2);
      prisma.user.create.mockResolvedValue(buildTargetUser());

      await service.inviteTeamMember({ email: 'Member@Acme.com' }, poc);

      expect(prisma.user.count).toHaveBeenCalledWith({
        where: {
          clientId: 'client-1',
          deletedAt: null,
          status: { in: [UserStatus.INVITED, UserStatus.ACTIVE] },
        },
      });
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
