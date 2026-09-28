import { NotFoundException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ClientScopeGuard } from './client-scope.guard.js';

function ctx(user: { role: string; clientId: string | null }, params: Record<string, string> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, params }) }),
  } as unknown as ExecutionContext;
}

describe('ClientScopeGuard', () => {
  const guard = new ClientScopeGuard();

  it('lets a client user through on their own client', () => {
    expect(guard.canActivate(ctx({ role: 'CLIENT_MEMBER', clientId: 'a' }, { clientId: 'a' }))).toBe(true);
  });

  it("404s a client user on another client's route — without confirming it exists", () => {
    expect(() => guard.canActivate(ctx({ role: 'CLIENT_POC', clientId: 'a' }, { clientId: 'b' }))).toThrow(NotFoundException);
  });

  it('404s a client user with no client at all', () => {
    expect(() => guard.canActivate(ctx({ role: 'CLIENT_MEMBER', clientId: null }, { clientId: 'b' }))).toThrow(NotFoundException);
  });

  it('lets admins act on any client', () => {
    expect(guard.canActivate(ctx({ role: 'ADMIN', clientId: null }, { clientId: 'b' }))).toBe(true);
  });

  it('ignores routes without a :clientId param', () => {
    expect(guard.canActivate(ctx({ role: 'CLIENT_MEMBER', clientId: 'a' }, {}))).toBe(true);
  });
});
