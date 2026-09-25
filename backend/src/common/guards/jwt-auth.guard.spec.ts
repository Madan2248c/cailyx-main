import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { JwtAuthGuard, type AuthenticatedRequest } from './jwt-auth.guard.js';

function createContext(headers: Record<string, string>): {
  context: ExecutionContext;
  request: Partial<AuthenticatedRequest>;
} {
  const request: Partial<AuthenticatedRequest> = { headers: headers as never };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: { verify: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    jwtService = { verify: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [JwtAuthGuard, { provide: JwtService, useValue: jwtService }],
    }).compile();

    guard = moduleRef.get(JwtAuthGuard);
  });

  it('throws Unauthorized when there is no Authorization header', () => {
    const { context } = createContext({});
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('throws Unauthorized when the header is not a Bearer token', () => {
    const { context } = createContext({ authorization: 'Basic abc123' });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('throws Unauthorized when the token fails verification', () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('invalid signature');
    });
    const { context } = createContext({ authorization: 'Bearer bad.token' });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('attaches the decoded payload to the request and allows the request through', () => {
    const payload = { sub: 'user-1', role: 'ADMIN', clientId: null };
    jwtService.verify.mockReturnValue(payload);
    const { context, request } = createContext({ authorization: 'Bearer good.token' });

    expect(guard.canActivate(context)).toBe(true);
    expect(jwtService.verify).toHaveBeenCalledWith('good.token');
    expect(request.user).toEqual(payload);
  });
});
