import { vi } from 'vitest';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

function buildRawPrismaMock() {
  return {
    user: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    refreshToken: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    authToken: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    client: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    rolePermission: {
      findFirst: vi.fn(),
    },
  };
}

export type PrismaMock = ReturnType<typeof buildRawPrismaMock>;

/** A fully mocked PrismaService — every delegate method used by the auth module is a vi.fn(). */
export function createPrismaMock(): PrismaMock {
  return buildRawPrismaMock();
}

/** Casts a PrismaMock for use as the `useValue` when overriding PrismaService in a TestingModule. */
export function asPrismaService(mock: PrismaMock): PrismaService {
  return mock as unknown as PrismaService;
}
