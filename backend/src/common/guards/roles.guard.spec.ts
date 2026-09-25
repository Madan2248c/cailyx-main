import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { Role } from '../../generated/prisma/enums.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';

function createContext(user: AuthenticatedRequest['user']): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { get: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    reflector = { get: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [RolesGuard, { provide: Reflector, useValue: reflector }],
    }).compile();

    guard = moduleRef.get(RolesGuard);
  });

  it('allows the request through when the route has no @Roles restriction', () => {
    reflector.get.mockReturnValue(undefined);
    const context = createContext({ sub: 'u1', role: Role.CLIENT_MEMBER, clientId: 'c1' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows the request through when the caller has one of the required roles', () => {
    reflector.get.mockReturnValue([Role.ADMIN]);
    const context = createContext({ sub: 'u1', role: Role.ADMIN, clientId: null });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws Forbidden when the caller does not have a required role', () => {
    reflector.get.mockReturnValue([Role.ADMIN]);
    const context = createContext({ sub: 'u1', role: Role.CLIENT_POC, clientId: 'c1' });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
