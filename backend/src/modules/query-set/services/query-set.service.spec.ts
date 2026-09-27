import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../test/mocks/prisma.mock.js';
import { QuerySetGenerationService } from './query-set-generation.service.js';
import { QuerySetService } from './query-set.service.js';
import type { BucketProposal } from '../query-set.types.js';

/**
 * The orchestrator's decisions: draft-only mutation, 409 without a
 * CompanyContextProfile, guardrail rejection surfaces as 409 (not a silent
 * auto-fix of bucket count / unbranded floor), per-bucket generation
 * failure never aborts the whole set.
 */
describe('QuerySetService', () => {
  let service: QuerySetService;
  let prisma: PrismaMock;
  let generation: { proposeBuckets: ReturnType<typeof vi.fn>; generatePrompts: ReturnType<typeof vi.fn> };

  const project = { id: 'project-1', clientId: 'client-1', deletedAt: null };

  function profileRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'profile-1',
      projectId: 'project-1',
      profileJson: {
        identity: { business_name: { value: 'Northwind Robotics' } },
        descriptions: { short: { value: 'A robotics company.' }, one_line: null },
        offerings: { services: [{ value: 'warehouse automation' }] },
        positioning: {},
        customers: {},
        geography: {},
        go_to_market: {},
        credibility: {},
        technology: {},
      },
      version: 1,
      ...overrides,
    };
  }

  function groundedBucket(overrides: Partial<BucketProposal> = {}): BucketProposal {
    return {
      name: 'warehouse-automation-fit',
      rationale: 'Targets warehouse automation buyers directly.',
      persona: 'buyer',
      funnelStage: 'problem_aware',
      branding: 'unbranded',
      targetCount: 10,
      ...overrides,
    };
  }

  beforeEach(async () => {
    prisma = createPrismaMock();
    generation = { proposeBuckets: vi.fn(), generatePrompts: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        QuerySetService,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: QuerySetGenerationService, useValue: generation },
      ],
    }).compile();
    service = moduleRef.get(QuerySetService);
  });

  describe('manual lifecycle', () => {
    it('create 404s when the project is not the caller client', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(service.create('client-1', 'project-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('addPrompt 400s on a non-draft set', async () => {
      prisma.querySet.findFirst.mockResolvedValue({ id: 'set-1', status: 'active' });
      await expect(service.addPrompt('client-1', 'set-1', { prompt: 'hi' })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.querySetItem.create).not.toHaveBeenCalled();
    });

    it('addPrompt creates a manual item on a draft set', async () => {
      prisma.querySet.findFirst.mockResolvedValue({ id: 'set-1', status: 'draft' });
      prisma.querySetItem.create.mockResolvedValue({ id: 'item-1' });
      await service.addPrompt('client-1', 'set-1', { prompt: 'What is warehouse automation?' });
      expect(prisma.querySetItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ prompt: 'What is warehouse automation?', generationMethod: 'manual', bucketId: null }),
        }),
      );
    });

    it('removePrompt 404s when the item does not belong to the set', async () => {
      prisma.querySet.findFirst.mockResolvedValue({ id: 'set-1', status: 'draft' });
      prisma.querySetItem.findFirst.mockResolvedValue(null);
      await expect(service.removePrompt('client-1', 'set-1', 'item-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('activate 400s on an already-active set', async () => {
      prisma.querySet.findFirst.mockResolvedValue({ id: 'set-1', status: 'active' });
      await expect(service.activate('client-1', 'set-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('activate locks a draft', async () => {
      prisma.querySet.findFirst.mockResolvedValue({ id: 'set-1', status: 'draft' });
      prisma.querySet.update.mockResolvedValue({ id: 'set-1', status: 'active' });
      await service.activate('client-1', 'set-1');
      expect(prisma.querySet.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'set-1' }, data: expect.objectContaining({ status: 'active' }) }),
      );
    });
  });

  describe('generate', () => {
    it('409s when no CompanyContextProfile exists — never invents a context', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.companyContextProfile.findFirst.mockResolvedValue(null);
      await expect(service.generate('client-1', 'project-1')).rejects.toBeInstanceOf(ConflictException);
      expect(generation.proposeBuckets).not.toHaveBeenCalled();
    });

    it('409s when the guardrail-passed bucket count is out of range — does not auto-fix', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.companyContextProfile.findFirst.mockResolvedValue(profileRow());
      generation.proposeBuckets.mockResolvedValue([groundedBucket(), groundedBucket({ name: 'b2' })]); // only 2, below MIN_BUCKETS=4
      await expect(service.generate('client-1', 'project-1')).rejects.toBeInstanceOf(ConflictException);
      expect(generation.generatePrompts).not.toHaveBeenCalled();
    });

    it('409s when the unbranded floor is violated post-guardrails', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.companyContextProfile.findFirst.mockResolvedValue(profileRow());
      generation.proposeBuckets.mockResolvedValue([
        groundedBucket({ name: 'b1', branding: 'branded', targetCount: 50 }),
        groundedBucket({ name: 'b2', branding: 'branded', targetCount: 50 }),
        groundedBucket({ name: 'b3', branding: 'unbranded', targetCount: 10 }),
        groundedBucket({ name: 'b4', branding: 'unbranded', targetCount: 10 }),
      ]);
      await expect(service.generate('client-1', 'project-1')).rejects.toBeInstanceOf(ConflictException);
      expect(generation.generatePrompts).not.toHaveBeenCalled();
    });

    it('persists surviving buckets and generated prompts; one bucket failing never aborts the set', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.companyContextProfile.findFirst.mockResolvedValue(profileRow());
      generation.proposeBuckets.mockResolvedValue([
        groundedBucket({ name: 'b1', targetCount: 10 }),
        groundedBucket({ name: 'b2', targetCount: 10 }),
        groundedBucket({ name: 'b3', targetCount: 10 }),
        groundedBucket({ name: 'b4', targetCount: 10 }),
      ]);
      generation.generatePrompts.mockImplementation((bucket: BucketProposal) => {
        if (bucket.name === 'b2') return Promise.reject(new Error('actor exploded'));
        return Promise.resolve([`prompt for ${bucket.name}`]);
      });
      prisma.querySet.findFirst.mockResolvedValue(null); // no existing versions
      prisma.querySet.create.mockResolvedValue({ id: 'set-1', projectId: 'project-1', version: 1, status: 'draft' });
      prisma.querySetBucket.create.mockImplementation((args: { data: { name: string } }) =>
        Promise.resolve({ id: `bucket-${args.data.name}`, ...args.data }),
      );

      const result = await service.generate('client-1', 'project-1', { tier: 'starter' });

      expect(prisma.querySetBucket.create).toHaveBeenCalledTimes(4); // all 4 grounded buckets persisted
      // b2's failed generation still creates the bucket row but no items for it.
      const b2Call = prisma.querySetItem.createMany.mock.calls.find(
        (c: unknown[]) => (c[0] as { data: Array<{ bucketId: string }> }).data[0]?.bucketId === 'bucket-b2',
      );
      expect(b2Call).toBeUndefined();
      expect(result.proposedBuckets).toHaveLength(4);
    });
  });

  describe('fork', () => {
    it('copies buckets and items into a new draft version', async () => {
      prisma.querySet.findFirst
        .mockResolvedValueOnce({
          id: 'set-1',
          projectId: 'project-1',
          version: 1,
          label: null,
          status: 'active',
          source: 'llm_generated',
          generationContextId: 'profile-1',
          generationTier: 'full',
          buckets: [{ id: 'bucket-1', name: 'b', rationale: 'r', persona: 'buyer', funnelStage: 'problem_aware', branding: 'unbranded', targetCount: 10 }],
          items: [{ id: 'item-1', bucketId: 'bucket-1', prompt: 'p', funnelStage: 'problem_aware', branding: 'unbranded', generationMethod: 'llm_generated' }],
        })
        .mockResolvedValueOnce({ version: 1 }); // latest-version lookup
      prisma.querySet.create.mockResolvedValue({ id: 'set-2', version: 2 });
      prisma.querySetBucket.create.mockResolvedValue({ id: 'bucket-2' });

      await service.fork('client-1', 'set-1');

      expect(prisma.querySet.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: 2, status: 'draft' }) }));
      expect(prisma.querySetItem.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ bucketId: 'bucket-2', querySetId: 'set-2' }) }),
      );
    });
  });

  describe('export', () => {
    it('404s when no active set exists', async () => {
      prisma.project.findFirst.mockResolvedValue(project);
      prisma.querySet.findFirst.mockResolvedValue(null);
      await expect(service.export('client-1', 'project-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
