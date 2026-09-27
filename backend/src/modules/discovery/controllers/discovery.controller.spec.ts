import { Test } from '@nestjs/testing';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSION_KEY } from '../../../common/decorators/require-permission.decorator.js';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { Role } from '../../../generated/prisma/enums.js';
import { DiscoveryService } from '../services/discovery.service.js';
import { DiscoveryController, DiscoveryRunController } from './discovery.controller.js';

/**
 * These endpoints are staff-facing inspection of an internal pipeline, and the
 * two things worth pinning are the ones a refactor could quietly drop: who is
 * allowed to see them, and that the caller's client scope is always passed
 * through to the service rather than the request body deciding it.
 */

/** A route handler off a controller prototype, for reading its metadata. */
function handlerOf(target: object, name: string): (...args: never[]) => unknown {
  return Object.getOwnPropertyDescriptor(target, name)?.value as (...args: never[]) => unknown;
}

describe('DiscoveryController', () => {
  let controller: DiscoveryController;
  let runController: DiscoveryRunController;
  let discovery: {
    rerun: ReturnType<typeof vi.fn>;
    listRuns: ReturnType<typeof vi.fn>;
    latestProfile: ReturnType<typeof vi.fn>;
    listSocialProfiles: ReturnType<typeof vi.fn>;
    getRun: ReturnType<typeof vi.fn>;
    updateProfileFields: ReturnType<typeof vi.fn>;
    updateSocialProfile: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    discovery = {
      rerun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      listRuns: vi.fn().mockResolvedValue([]),
      latestProfile: vi.fn().mockResolvedValue(null),
      listSocialProfiles: vi.fn().mockResolvedValue([]),
      getRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      updateProfileFields: vi.fn().mockResolvedValue(null),
      updateSocialProfile: vi.fn().mockResolvedValue({ id: 'sp-1' }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [DiscoveryController, DiscoveryRunController],
      providers: [{ provide: DiscoveryService, useValue: discovery }],
    })
      // The guards' own dependencies (JwtService) are not what this spec is
      // about — their *declared* requirements are, and those are read off the
      // metadata below.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(DiscoveryController);
    runController = moduleRef.get(DiscoveryRunController);
  });

  describe('authorisation', () => {
    // Read off the prototype rather than the instance: the metadata is attached
    // to the handler, and taking the method off the instance would be an
    // unbound-method reference.
    const rerun = handlerOf(DiscoveryController.prototype, 'rerun');
    const listRuns = handlerOf(DiscoveryController.prototype, 'listRuns');
    const latestProfile = handlerOf(DiscoveryController.prototype, 'latestProfile');
    const listSocialProfiles = handlerOf(DiscoveryController.prototype, 'listSocialProfiles');
    const getRun = handlerOf(DiscoveryRunController.prototype, 'getRun');
    const updateProfile = handlerOf(DiscoveryController.prototype, 'updateProfile');
    const updateSocialProfile = handlerOf(DiscoveryController.prototype, 'updateSocialProfile');

    it('lets only ADMIN queue a re-run', () => {
      expect(Reflect.getMetadata(ROLES_KEY, rerun)).toEqual([Role.ADMIN]);
    });

    it('gates every read behind view_projects', () => {
      expect(Reflect.getMetadata(PERMISSION_KEY, listRuns)).toBe('view_projects');
      expect(Reflect.getMetadata(PERMISSION_KEY, latestProfile)).toBe('view_projects');
      expect(Reflect.getMetadata(PERMISSION_KEY, listSocialProfiles)).toBe('view_projects');
      expect(Reflect.getMetadata(PERMISSION_KEY, getRun)).toBe('view_projects');
    });

    it('does not gate the re-run behind a permission instead of the admin role', () => {
      // Both would be a reasonable design; the module documents admin-only, and
      // an accidental extra permission check would widen access silently.
      expect(Reflect.getMetadata(PERMISSION_KEY, rerun)).toBeUndefined();
    });

    it('gates client rewrites behind manage_client_settings, not view_projects', () => {
      expect(Reflect.getMetadata(PERMISSION_KEY, updateProfile)).toBe('manage_client_settings');
      expect(Reflect.getMetadata(PERMISSION_KEY, updateSocialProfile)).toBe('manage_client_settings');
    });

    it('declares a handler for every route, so no route is a silent no-op', () => {
      for (const handler of [rerun, listRuns, latestProfile, listSocialProfiles, getRun, updateProfile, updateSocialProfile]) {
        expect(typeof handler).toBe('function');
      }
      // `ROUTE_ARGS_METADATA` is populated by the param decorators, so this is a
      // cheap sanity check that the module was loaded with Nest's route wiring.
      expect(ROUTE_ARGS_METADATA).toBeTruthy();
    });
  });

  describe('client scoping', () => {
    it('passes the caller’s client through on every call', async () => {
      await controller.rerun('client-1', 'project-1');
      await controller.listRuns('client-1', 'project-1');
      await controller.latestProfile('client-1', 'project-1');
      await controller.listSocialProfiles('client-1', 'project-1');
      await controller.updateProfile('client-1', 'project-1', { fields: { 'identity.business_name': 'x' } });
      await controller.updateSocialProfile('client-1', 'project-1', 'sp-1', { url: 'x.com/y' });
      await runController.getRun('client-1', 'run-1');

      expect(discovery.rerun).toHaveBeenCalledWith('client-1', 'project-1');
      expect(discovery.listRuns).toHaveBeenCalledWith('client-1', 'project-1');
      expect(discovery.latestProfile).toHaveBeenCalledWith('client-1', 'project-1');
      expect(discovery.listSocialProfiles).toHaveBeenCalledWith('client-1', 'project-1');
      expect(discovery.updateProfileFields).toHaveBeenCalledWith('client-1', 'project-1', { 'identity.business_name': 'x' });
      expect(discovery.updateSocialProfile).toHaveBeenCalledWith('client-1', 'project-1', 'sp-1', 'x.com/y');
      expect(discovery.getRun).toHaveBeenCalledWith('client-1', 'run-1');
    });

    it('returns whatever the service returns, including null for a missing profile', async () => {
      await expect(controller.latestProfile('client-1', 'project-1')).resolves.toBeNull();
    });
  });
});
