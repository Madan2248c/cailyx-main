import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { Role } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../test/mocks/prisma.mock.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';
import { PermissionsGuard } from './permissions.guard.js';

function createContext(user: AuthenticatedRequest['user']): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: { get: ReturnType<typeof vi.fn> };
  let prisma: PrismaMock;

  beforeEach(async () => {
    reflector = { get: vi.fn() };
    prisma = createPrismaMock();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        { provide: Reflector, useValue: reflector },
        { provide: PrismaService, useValue: asPrismaService(prisma) },
      ],
    }).compile();

    guard = moduleRef.get(PermissionsGuard);
  });

  it('allows the request through when the route requires no permission', async () => {
    reflector.get.mockReturnValue(undefined);
    const context = createContext({ sub: 'u1', role: Role.CLIENT_MEMBER, clientId: 'c1' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.rolePermission.findFirst).not.toHaveBeenCalled();
  });

  it('bypasses the DB check entirely for ADMIN', async () => {
    reflector.get.mockReturnValue('manage_team');
    const context = createContext({ sub: 'admin-1', role: Role.ADMIN, clientId: null });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.rolePermission.findFirst).not.toHaveBeenCalled();
  });

  it('allows the request when the role has a matching, non-revoked grant', async () => {
    reflector.get.mockReturnValue('manage_team');
    prisma.rolePermission.findFirst.mockResolvedValue({ id: 'rp-1' });
    const context = createContext({ sub: 'poc-1', role: Role.CLIENT_POC, clientId: 'c1' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.rolePermission.findFirst).toHaveBeenCalledWith({
      where: { role: Role.CLIENT_POC, deletedAt: null, permission: { key: 'manage_team' } },
    });
  });

  it('throws Forbidden when the role has no matching grant', async () => {
    reflector.get.mockReturnValue('manage_team');
    prisma.rolePermission.findFirst.mockResolvedValue(null);
    const context = createContext({ sub: 'member-1', role: Role.CLIENT_MEMBER, clientId: 'c1' });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });
});
