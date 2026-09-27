/**
 * Query Set orchestrator — manual CRUD on draft sets, two-step LLM
 * generation, activate/fork lifecycle, export. See
 * docs/analysis/query-set.md.
 *
 * Immutability rule: mutations (`addPrompt`, `removePrompt`, `generate`)
 * only ever touch a `draft` set. `activate()` locks it; changing an active
 * set means `fork()`-ing the next version. This is what makes a baseline
 * comparison meaningful — see the analysis doc's "Decisions carried over".
 *
 * @module query-set/services/query-set.service
 */

import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { CompanyContextProfileJson } from '../../discovery/discovery.types.js';
import { DEFAULT_TIER } from '../query-set.constants.js';
import type { GuardrailNote } from '../query-set.types.js';
import { applyGuardrails, checkBucketCount, checkUnbrandedFloor, rejectUngroundedBuckets } from './query-set.guardrails.js';
import { extractGroundingContext } from './query-set.grounding.js';
import { QuerySetGenerationService } from './query-set-generation.service.js';

export interface GenerateOptions {
  tier?: string;
}

@Injectable()
export class QuerySetService {
  private readonly logger = new Logger(QuerySetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly generation: QuerySetGenerationService,
  ) {}

  // ─── Manual lifecycle ───────────────────────────────────────────────────

  /** Creates a fresh draft (v1) for a project. Manual source, no generation. */
  async create(clientId: string, projectId: string, label?: string) {
    await this.assertProjectInClient(projectId, clientId);
    return this.prisma.querySet.create({
      data: { projectId, version: 1, label, status: 'draft', source: 'manual' },
    });
  }

  /** Adds one manually-typed prompt to a draft set. 409 if the set isn't a draft. */
  async addPrompt(
    clientId: string,
    querySetId: string,
    input: { prompt: string; funnelStage?: string; branding?: string },
  ) {
    const set = await this.getOwned(clientId, querySetId);
    this.assertDraft(set);
    return this.prisma.querySetItem.create({
      data: {
        querySetId,
        bucketId: null,
        prompt: input.prompt,
        funnelStage: (input.funnelStage as any) ?? 'problem_aware',
        branding: (input.branding as any) ?? null,
        generationMethod: 'manual',
      },
    });
  }

  /** Removes one prompt from a draft set. 409 if the set isn't a draft. */
  async removePrompt(clientId: string, querySetId: string, itemId: string) {
    const set = await this.getOwned(clientId, querySetId);
    this.assertDraft(set);
    const item = await this.prisma.querySetItem.findFirst({ where: { id: itemId, querySetId } });
    if (!item) throw new NotFoundException('Prompt not found.');
    await this.prisma.querySetItem.delete({ where: { id: itemId } });
    return { deleted: true };
  }

  /** Locks a draft set. Once active, only fork() creates further change. */
  async activate(clientId: string, querySetId: string) {
    const set = await this.getOwned(clientId, querySetId);
    this.assertDraft(set);
    return this.prisma.querySet.update({
      where: { id: querySetId },
      data: { status: 'active', activatedAt: new Date() },
    });
  }

  /**
   * Creates a new draft version from an existing set (any status), copying
   * its buckets and items. The new version is independent — editing it
   * never touches the set it forked from.
   */
  async fork(clientId: string, querySetId: string) {
    const set = await this.getOwned(clientId, querySetId, { include: { buckets: true, items: true } });
    const latest = await this.prisma.querySet.findFirst({
      where: { projectId: set.projectId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? set.version) + 1;

    return this.prisma.$transaction(async (tx) => {
      const newSet = await tx.querySet.create({
        data: {
          projectId: set.projectId,
          version: nextVersion,
          label: set.label,
          status: 'draft',
          source: set.source,
          generationContextId: set.generationContextId,
          generationTier: set.generationTier,
        },
      });

      const bucketIdMap = new Map<string, string>();
      for (const bucket of (set as any).buckets ?? []) {
        const newBucket = await tx.querySetBucket.create({
          data: {
            querySetId: newSet.id,
            name: bucket.name,
            rationale: bucket.rationale,
            persona: bucket.persona,
            funnelStage: bucket.funnelStage,
            branding: bucket.branding,
            targetCount: bucket.targetCount,
          },
        });
        bucketIdMap.set(bucket.id, newBucket.id);
      }

      for (const item of (set as any).items ?? []) {
        await tx.querySetItem.create({
          data: {
            querySetId: newSet.id,
            bucketId: item.bucketId ? (bucketIdMap.get(item.bucketId) ?? null) : null,
            prompt: item.prompt,
            funnelStage: item.funnelStage,
            branding: item.branding,
            generationMethod: item.generationMethod,
          },
        });
      }

      return newSet;
    });
  }

  // ─── Generation ─────────────────────────────────────────────────────────

  /**
   * Two-step LLM generation: propose buckets grounded in the project's
   * latest CompanyContextProfile, apply guardrails, then generate prompts
   * per surviving bucket. 409 without a profile to ground on — generation
   * never invents a context to fill the gap.
   */
  async generate(clientId: string, projectId: string, opts: GenerateOptions = {}) {
    await this.assertProjectInClient(projectId, clientId);
    const tier = opts.tier ?? DEFAULT_TIER;

    const profile = await this.prisma.companyContextProfile.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
    if (!profile) {
      throw new ConflictException(
        'No CompanyContextProfile exists for this project yet — run Discovery before generating a query set.',
      );
    }

    const profileJson = profile.profileJson as unknown as CompanyContextProfileJson;
    const context = extractGroundingContext(profileJson);
    const businessSummary =
      profileJson.descriptions?.short?.value ?? profileJson.descriptions?.one_line?.value ?? 'Unknown business.';

    const rawProposal = await this.generation.proposeBuckets(context, businessSummary);

    // Grounding rejection runs first — everything else sizes what survives.
    const grounded = rejectUngroundedBuckets(rawProposal, context);
    const bucketCountNotes = checkBucketCount(grounded.buckets);
    if (bucketCountNotes.length > 0) {
      throw new ConflictException(
        `Bucket proposal rejected: ${bucketCountNotes.map((n) => n.detail).join(' ')} Try again — bucket invention is non-deterministic.`,
      );
    }

    const guarded = applyGuardrails(rawProposal, context, tier);
    const unbrandedNotes = checkUnbrandedFloor(guarded.buckets);
    if (unbrandedNotes.length > 0) {
      throw new ConflictException(
        `Bucket proposal rejected: ${unbrandedNotes.map((n) => n.detail).join(' ')} Try again — bucket invention is non-deterministic.`,
      );
    }

    // Generate prompts per surviving bucket — one bucket's failure never
    // aborts the whole set; it just yields fewer prompts than targetCount.
    const perBucketPrompts = await Promise.all(
      guarded.buckets.map(async (bucket) => {
        try {
          const prompts = await this.generation.generatePrompts(bucket, businessSummary);
          return { bucket, prompts: prompts.slice(0, bucket.targetCount) };
        } catch (err) {
          this.logger.warn(`Prompt generation failed for bucket "${bucket.name}": ${(err as Error).message}`);
          return { bucket, prompts: [] as string[] };
        }
      }),
    );

    const set = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.querySet.findFirst({ where: { projectId }, orderBy: { version: 'desc' }, select: { version: true } });
      const newSet = await tx.querySet.create({
        data: {
          projectId,
          version: (latest?.version ?? 0) + 1,
          status: 'draft',
          source: 'llm_generated',
          generationContextId: profile.id,
          generationTier: tier,
        },
      });

      for (const { bucket, prompts } of perBucketPrompts) {
        const newBucket = await tx.querySetBucket.create({
          data: {
            querySetId: newSet.id,
            name: bucket.name,
            rationale: bucket.rationale,
            persona: bucket.persona,
            funnelStage: bucket.funnelStage,
            branding: bucket.branding,
            targetCount: bucket.targetCount,
          },
        });
        if (prompts.length > 0) {
          await tx.querySetItem.createMany({
            data: prompts.map((prompt) => ({
              querySetId: newSet.id,
              bucketId: newBucket.id,
              prompt,
              funnelStage: bucket.funnelStage,
              branding: bucket.branding,
              generationMethod: 'llm_generated' as const,
            })),
          });
        }
      }

      return newSet;
    });

    return {
      ...set,
      proposedBuckets: guarded.buckets,
      guardrailNotes: [...grounded.notes, ...guarded.notes] as GuardrailNote[],
    };
  }

  // ─── Reads ──────────────────────────────────────────────────────────────

  async list(clientId: string, projectId: string, status?: string) {
    await this.assertProjectInClient(projectId, clientId);
    return this.prisma.querySet.findMany({
      where: { projectId, ...(status ? { status: status as any } : {}) },
      orderBy: { version: 'desc' },
    });
  }

  async getOne(clientId: string, querySetId: string) {
    return this.getOwned(clientId, querySetId, { include: { buckets: true, items: true } });
  }

  async export(clientId: string, projectId: string) {
    await this.assertProjectInClient(projectId, clientId);
    const active = await this.prisma.querySet.findFirst({
      where: { projectId, status: 'active' },
      orderBy: { version: 'desc' },
      include: { buckets: true, items: true },
    });
    if (!active) throw new NotFoundException('No active query set for this project.');
    return active;
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private async assertProjectInClient(projectId: string, clientId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundException('Project not found.');
  }

  private async getOwned(clientId: string, querySetId: string, opts: { include?: any } = {}) {
    const set = await this.prisma.querySet.findFirst({
      where: { id: querySetId, project: { clientId, deletedAt: null } },
      ...opts,
    });
    if (!set) throw new NotFoundException('Query set not found.');
    return set as any;
  }

  private assertDraft(set: { status: string }) {
    if (set.status !== 'draft') {
      throw new BadRequestException('Only a draft query set can be modified. Fork it to create a new editable version.');
    }
  }
}
