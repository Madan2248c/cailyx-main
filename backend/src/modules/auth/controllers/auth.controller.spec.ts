import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { AuthService } from '../services/auth.service.js';
import { AuthController } from './auth.controller.js';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: Record<string, ReturnType<typeof vi.fn>>;

  const fakeRequest = {
    headers: { 'user-agent': 'test-agent' },
    ip: '127.0.0.1',
  } as never;

  beforeEach(async () => {
    authService = {
      login: vi.fn().mockResolvedValue({ session: 'login' }),
      refresh: vi.fn().mockResolvedValue({ session: 'refresh' }),
      logout: vi.fn().mockResolvedValue({ success: true }),
      acceptInvite: vi.fn().mockResolvedValue({ session: 'accept-invite' }),
      isInviteTokenValid: vi.fn().mockResolvedValue(true),
      forgotPassword: vi.fn().mockResolvedValue({ message: 'generic' }),
      resetPassword: vi.fn().mockResolvedValue({ session: 'reset-password' }),
      isResetTokenValid: vi.fn().mockResolvedValue(false),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    })
      // `me()` carries @UseGuards(JwtAuthGuard); overriding it is the
      // documented way to satisfy that without wiring up JwtService here —
      // these tests call controller methods directly, never through Nest's
      // HTTP pipeline, so the guard's own logic isn't what's under test.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(AuthController);
  });

  it('login forwards the DTO and request metadata to the service', async () => {
    const dto = { email: 'a@b.com', password: 'pw' };
    const result = await controller.login(dto, fakeRequest);

    expect(authService.login).toHaveBeenCalledWith(dto, {
      userAgent: 'test-agent',
      ipAddress: '127.0.0.1',
    });
    expect(result).toEqual({ session: 'login' });
  });

  it('refresh forwards the DTO and request metadata to the service', async () => {
    const dto = { refreshToken: 'raw' };
    await controller.refresh(dto, fakeRequest);

    expect(authService.refresh).toHaveBeenCalledWith(dto, {
      userAgent: 'test-agent',
      ipAddress: '127.0.0.1',
    });
  });

  it('logout forwards the DTO only', async () => {
    const dto = { refreshToken: 'raw' };
    const result = await controller.logout(dto);

    expect(authService.logout).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ success: true });
  });

  it('acceptInvite forwards the DTO and request metadata to the service', async () => {
    const dto = { token: 'raw', password: 'newpass123' };
    await controller.acceptInvite(dto, fakeRequest);

    expect(authService.acceptInvite).toHaveBeenCalledWith(dto, {
      userAgent: 'test-agent',
      ipAddress: '127.0.0.1',
    });
  });

  it('validateInvite wraps the service result in { valid }', async () => {
    const result = await controller.validateInvite({ token: 'raw' });
    expect(authService.isInviteTokenValid).toHaveBeenCalledWith('raw');
    expect(result).toEqual({ valid: true });
  });

  it('forgotPassword forwards the DTO only', async () => {
    const dto = { email: 'a@b.com' };
    const result = await controller.forgotPassword(dto);

    expect(authService.forgotPassword).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ message: 'generic' });
  });

  it('resetPassword forwards the DTO and request metadata to the service', async () => {
    const dto = { token: 'raw', password: 'newpass123' };
    await controller.resetPassword(dto, fakeRequest);

    expect(authService.resetPassword).toHaveBeenCalledWith(dto, {
      userAgent: 'test-agent',
      ipAddress: '127.0.0.1',
    });
  });

  it('validateReset wraps the service result in { valid }', async () => {
    const result = await controller.validateReset({ token: 'raw' });
    expect(authService.isResetTokenValid).toHaveBeenCalledWith('raw');
    expect(result).toEqual({ valid: false });
  });

  it('me returns the CurrentUser payload as-is', () => {
    const payload = { sub: 'u1', role: 'ADMIN' as const, clientId: null };
    expect(controller.me(payload)).toEqual(payload);
  });
});
