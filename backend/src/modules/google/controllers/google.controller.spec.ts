import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSION_KEY } from '../../../common/decorators/require-permission.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { GoogleService } from '../google.service.js';
import { GoogleCallbackController, GoogleController, GoogleProjectController } from './google.controller.js';

/** A route handler off a controller prototype, for reading its metadata. */
function handlerOf(target: object, name: string): (...args: never[]) => unknown {
  return Object.getOwnPropertyDescriptor(target, name)?.value as (...args: never[]) => unknown;
}

describe('GoogleController', () => {
  let controller: GoogleController;
  let projectController: GoogleProjectController;
  let google: {
    connectUrl: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    getSearchConsole: ReturnType<typeof vi.fn>;
    getAnalytics: ReturnType<typeof vi.fn>;
    listGscSites: ReturnType<typeof vi.fn>;
    listGaProperties: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    google = {
      connectUrl: vi.fn().mockResolvedValue({ url: 'https://accounts.google.com/…' }),
      getStatus: vi.fn().mockResolvedValue({ gsc: { connected: false }, ga: { connected: false } }),
      disconnect: vi.fn().mockResolvedValue({ success: true }),
      getSearchConsole: vi.fn().mockResolvedValue({}),
      getAnalytics: vi.fn().mockResolvedValue({}),
      listGscSites: vi.fn().mockResolvedValue([]),
      listGaProperties: vi.fn().mockResolvedValue([]),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [GoogleController, GoogleProjectController, GoogleCallbackController],
      providers: [{ provide: GoogleService, useValue: google }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(GoogleController);
    projectController = moduleRef.get(GoogleProjectController);
  });

  it('gates connect/disconnect behind manage_client_settings (POC-only writes)', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, handlerOf(GoogleController.prototype, 'connectUrl'))).toBe(
      'manage_client_settings',
    );
    expect(Reflect.getMetadata(PERMISSION_KEY, handlerOf(GoogleController.prototype, 'disconnect'))).toBe(
      'manage_client_settings',
    );
  });

  it('gates reads behind view_projects (POC and members)', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, handlerOf(GoogleController.prototype, 'status'))).toBe('view_projects');
    expect(Reflect.getMetadata(PERMISSION_KEY, handlerOf(GoogleProjectController.prototype, 'searchConsole'))).toBe(
      'view_projects',
    );
    expect(Reflect.getMetadata(PERMISSION_KEY, handlerOf(GoogleProjectController.prototype, 'analytics'))).toBe(
      'view_projects',
    );
  });

  it('passes scope and defaults through', async () => {
    await controller.connectUrl('client-1', { provider: 'gsc' });
    expect(google.connectUrl).toHaveBeenCalledWith('client-1', 'gsc');
    await controller.status('client-1');
    expect(google.getStatus).toHaveBeenCalledWith('client-1');
    await projectController.searchConsole('client-1', 'project-1', {});
    expect(google.getSearchConsole).toHaveBeenCalledWith('client-1', 'project-1', 28, undefined);
    await projectController.searchConsole('client-1', 'project-1', { siteUrl: 'sc-domain:x.com' });
    expect(google.getSearchConsole).toHaveBeenCalledWith('client-1', 'project-1', 28, 'sc-domain:x.com');
    await projectController.analytics('client-1', 'project-1', { days: 7 });
    expect(google.getAnalytics).toHaveBeenCalledWith('client-1', 'project-1', 7, undefined);
    await projectController.sites('client-1', 'project-1');
    expect(google.listGscSites).toHaveBeenCalledWith('client-1', 'project-1');
    await projectController.properties('client-1', 'project-1');
    expect(google.listGaProperties).toHaveBeenCalledWith('client-1', 'project-1');
  });
});
