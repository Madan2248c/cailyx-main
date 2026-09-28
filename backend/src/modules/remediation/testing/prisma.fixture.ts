/**
 * A Prisma mock covering only this module's tables (plus `project`), kept
 * here rather than in the shared test/mocks file so this module adds no
 * edits to shared test infrastructure.
 *
 * @module remediation/testing/prisma.fixture
 */

import { vi } from 'vitest';
import type { PrismaService } from '../../../prisma/prisma.service.js';

export function createRemediationPrismaMock() {
  const mock = {
    project: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
    remediationRun: { create: vi.fn(), update: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    fixSpec: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    fixSpecSource: { deleteMany: vi.fn() },
    fixSpecEvent: { count: vi.fn() },
    $transaction: vi.fn(async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : (ops as (tx: unknown) => unknown)(mock))),
  };
  return mock;
}

export type RemediationPrismaMock = ReturnType<typeof createRemediationPrismaMock>;

export function asPrisma(mock: RemediationPrismaMock): PrismaService {
  return mock as unknown as PrismaService;
}
