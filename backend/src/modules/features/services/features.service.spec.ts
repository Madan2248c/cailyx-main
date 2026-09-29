import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { FEATURE_KEYS } from '../features.constants.js';
import { FeaturesService } from './features.service.js';

describe('FeaturesService', () => {
  let flags: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  let service: FeaturesService;

  beforeEach(() => {
    flags = { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() };
    service = new FeaturesService({ clientFeatureFlag: flags } as unknown as PrismaService);
  });

  it('every feature is ON when nothing has been changed', async () => {
    const map = await service.getFlags('client-1');
    expect(Object.keys(map).sort()).toEqual([...FEATURE_KEYS].sort());
    expect(Object.values(map).every(Boolean)).toBe(true);
  });

  it('a stored switch turns that one feature off and leaves the rest on', async () => {
    flags.findMany.mockResolvedValue([{ featureKey: 'backlinks', enabled: false }]);
    const map = await service.getFlags('client-1');
    expect(map.backlinks).toBe(false);
    expect(map.reports).toBe(true);
  });

  it('ignores stored keys it no longer knows', async () => {
    flags.findMany.mockResolvedValue([{ featureKey: 'retired-thing', enabled: false }]);
    const map = await service.getFlags('client-1');
    expect('retired-thing' in map).toBe(false);
  });

  it('creates a row the first time a feature is switched', async () => {
    flags.findFirst.mockResolvedValue(null);
    await service.setFlag('client-1', 'social', false, 'admin-1');
    expect(flags.create).toHaveBeenCalledWith({ data: { clientId: 'client-1', featureKey: 'social', enabled: false, updatedBy: 'admin-1' } });
    expect(flags.update).not.toHaveBeenCalled();
  });

  it('updates the existing row instead of adding a second', async () => {
    flags.findFirst.mockResolvedValue({ id: 'flag-1' });
    await service.setFlag('client-1', 'social', true, 'admin-1');
    expect(flags.update).toHaveBeenCalledWith({ where: { id: 'flag-1' }, data: { enabled: true, updatedBy: 'admin-1' } });
    expect(flags.create).not.toHaveBeenCalled();
  });

  it('rejects a feature it does not know', async () => {
    await expect(service.setFlag('client-1', 'made-up', false, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(flags.create).not.toHaveBeenCalled();
  });
});
