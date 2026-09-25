import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { LlmService } from '../../llm/llm.service.js';
import { asPrismaService, createPrismaMock, type PrismaMock } from '../../../../test/mocks/prisma.mock.js';
import { SOCIAL_ACTIVITY_QUEUE } from '../queue/social-activity.queue.js';
import { ApifyService } from './apify.service.js';
import { handleFromUrl, SocialActivityService } from './social-activity.service.js';

/**
 * The orchestrator's decisions: spend is opt-in (400 without it), active
 * runs are returned not duplicated, the key is re-checked at execution,
 * targets are verified-company-only, and personal shapes never pull.
 */

describe('SocialActivityService', () => {
  let service: SocialActivityService;
  let prisma: PrismaMock;
  let queue: { add: ReturnType<typeof vi.fn> };
  let apify: { run: ReturnType<typeof vi.fn>; enabled: boolean };
  let llm: { json: ReturnType<typeof vi.fn> };

  const project = { id: 'project-1', clientId: 'client-1', deletedAt: null };

  function runRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'run-1',
      projectId: 'project-1',
      status: 'QUEUED',
      triggeredBy: 'MANUAL',
      previousRunId: null,
      platforms: ['linkedin'],
      postsPerPlatform: 20,
      windowDays: 30,
      includeProbable: false,
      result: {},
      findings: [],
      deltas: [],
      ...overrides,
    };
  }

  beforeEach(async () => {
    prisma = createPrismaMock();
    queue = { add: vi.fn().mockResolvedValue({}) };
    apify = { run: vi.fn(), enabled: true };
    llm = { json: vi.fn().mockResolvedValue({ data: 'n', model: 'm' }) };
    const config = { get: vi.fn().mockReturnValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SocialActivityService,
        { provide: PrismaService, useValue: asPrismaService(prisma) },
        { provide: ConfigService, useValue: config },
        { provide: ApifyService, useValue: apify },
        { provide: LlmService, useValue: llm },
        { provide: getQueueToken(SOCIAL_ACTIVITY_QUEUE), useValue: queue },
      ],
    }).compile();
    service = moduleRef.get(SocialActivityService);
  });

  it('rerun 400s without confirmSpend — nothing run, nothing spent', async () => {
    prisma.project.findFirst.mockResolvedValue(project);
    await expect(service.rerun('client-1', 'project-1', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.socialActivityRun.create).not.toHaveBeenCalled();
  });

  it('startRun returns the active run instead of duplicating', async () => {
    prisma.project.findFirst.mockResolvedValue(project);
    const active = runRow({ status: 'RUNNING' });
    prisma.socialActivityRun.findFirst.mockResolvedValue(active);
    const out = await service.startRun('project-1');
    expect(out).toBe(active);
    expect(prisma.socialActivityRun.create).not.toHaveBeenCalled();
  });

  it('executeRun fails closed when the key vanished after trigger', async () => {
    apify.enabled = false;
    prisma.socialActivityRun.findUnique.mockResolvedValue(runRow());
    await service.executeRun('run-1');
    expect(prisma.socialActivityRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { status: 'FAILED', completedAt: expect.any(Date) },
    });
    expect(apify.run).not.toHaveBeenCalled();
  });

  it('executeRun pulls, aggregates, and completes with findings', async () => {
    prisma.socialActivityRun.findUnique.mockResolvedValue(runRow());
    prisma.socialProfile.findMany.mockResolvedValue([
      { platform: 'linkedin', url: 'https://linkedin.com/company/acme' },
    ]);
    apify.run.mockResolvedValue({
      results: [
        {
          platform: 'linkedin',
          role: 'posts',
          actorId: 'a/b',
          items: [
            {
              platform: 'linkedin',
              kind: 'post',
              postedAt: new Date().toISOString(),
              url: 'https://linkedin.com/posts/1',
              caption: 'hi',
              likeCount: 3,
              commentCount: 1,
              shareCount: 0,
              viewCount: null,
              followerCount: null,
              followingCount: null,
              postCount: null,
              actorId: 'a/b',
              raw: '{}',
            },
          ],
          costUsd: 0.01,
          error: null,
        },
      ],
      skipped: [],
      totalCostUsd: 0.01,
    });
    prisma.socialPost.findMany.mockResolvedValue([
      {
        platform: 'linkedin',
        kind: 'post',
        postedAt: new Date(),
        likeCount: 3,
        commentCount: 1,
        shareCount: 0,
        followerCount: null,
      },
    ]);

    await service.executeRun('run-1');

    expect(prisma.socialPost.createMany).toHaveBeenCalled();
    // The narrative save lands after COMPLETE — assert on the COMPLETE call itself.
    const complete = prisma.socialActivityRun.update.mock.calls.find((c) => c[0].data?.status === 'COMPLETE');
    expect(complete![0].where).toEqual({ id: 'run-1' });
    expect(complete![0].data.totalCostUsd).toBeCloseTo(0.01);
    expect(complete![0].data.result.platforms).toHaveLength(1);
  });

  it('terminal rows no-op on retry', async () => {
    prisma.socialActivityRun.findUnique.mockResolvedValue(runRow({ status: 'COMPLETE' }));
    await service.executeRun('run-1');
    expect(apify.run).not.toHaveBeenCalled();
  });
});

describe('handleFromUrl', () => {
  it('parses company slugs and post handles', () => {
    expect(handleFromUrl('linkedin', 'https://www.linkedin.com/company/acme/')).toBe('acme');
    expect(handleFromUrl('instagram', 'https://instagram.com/acme')).toBe('acme');
    expect(handleFromUrl('x', 'https://x.com/@acme')).toBe('acme');
    expect(handleFromUrl('youtube', 'https://youtube.com/@acme')).toBe('@acme');
    expect(handleFromUrl('tiktok', 'https://tiktok.com/@acme')).toBe('@acme');
  });
  it('returns null for person URLs and garbage', () => {
    // /in/ has no company/school/showcase segment — nothing to pull as.
    expect(handleFromUrl('linkedin', 'https://linkedin.com/in/jane')).toBeNull();
    expect(handleFromUrl('instagram', 'not a url')).toBeNull();
  });
});
