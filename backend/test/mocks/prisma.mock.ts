import { vi } from 'vitest';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

function buildRawPrismaMock() {
  return {
    user: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
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
    project: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    // --- Discovery / company-context module ---
    // Wider than any one stage needs: the pipeline reads and writes these from
    // several stages, and a mock that is missing a method fails as a confusing
    // "is not a function" inside whichever stage happened to call it first.
    discoveryRun: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    discoveredPage: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    socialProfile: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    companyContextProfile: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    // --- Technical Audit module ---
    technicalAuditRun: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditPage: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    technicalAuditSchedule: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    // --- Social Activity (digital presence) module ---
    socialActivityRun: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    socialPost: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      count: vi.fn(),
    },
    socialActivitySchedule: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    // --- Query Set module ---
    querySet: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    querySetBucket: {
      create: vi.fn(),
    },
    querySetItem: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    // --- Measurement module ---
    measurementRun: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    observation: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    // --- AEO Audit module ---
    aeoAudit: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    aeoSurfaceRun: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    aeoStance: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    competitor: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    // --- Gap Analysis module ---
    gapAnalysisRun: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    gapAnalysisRecommendation: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    // --- Competitors module ---
    competitorProfile: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    // --- Reporting module ---
    report: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    reportRevision: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    reportShareLink: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
}

export type PrismaMock = ReturnType<typeof buildRawPrismaMock> & { $transaction: ReturnType<typeof vi.fn> };

/**
 * A fully mocked PrismaService — every delegate method any module's service
 * calls is a `vi.fn()`. Not an exhaustive Prisma surface: a model that is
 * genuinely unused by the code under test does not need an entry, and adding
 * one for every generated model would be noise. Add a delegate (and the methods
 * a service actually calls on it) when a test needs it.
 *
 * `$transaction` runs its callback against this same mock (no real
 * transaction semantics) — good enough for a service whose test doubles for
 * every delegate the callback touches are already set up on this object.
 */
export function createPrismaMock(): PrismaMock {
  const mock = buildRawPrismaMock() as PrismaMock;
  mock.$transaction = vi.fn((arg: unknown) => (typeof arg === 'function' ? (arg as (tx: PrismaMock) => unknown)(mock) : Promise.all(arg as unknown[])));
  return mock;
}

/** Casts a PrismaMock for use as the `useValue` when overriding PrismaService in a TestingModule. */
export function asPrismaService(mock: PrismaMock): PrismaService {
  return mock as unknown as PrismaService;
}
