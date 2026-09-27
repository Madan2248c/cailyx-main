/**
 * Gap Analysis orchestrator — collects the latest completed run from each
 * of the three source modules, runs the one consolidation LLM call,
 * applies the guardrails, and persists. See docs/analysis/gap-analysis.md
 * and module README.
 *
 * @module gap-analysis/services/gap-analysis.service
 */

import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { AeoAuditCollector } from '../collectors/aeo-audit.collector.js';
import { SocialActivityCollector } from '../collectors/social-activity.collector.js';
import { TechnicalAuditCollector } from '../collectors/technical-audit.collector.js';
import type { CollectedSource, SourceFinding } from '../gap-analysis.types.js';
import { GapAnalysisGenerationService } from './gap-analysis-generation.service.js';
import { assignRanks, checkRecommendationCount, rejectUngroundedRecommendations } from './gap-analysis.guardrails.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
function asJson(value: unknown): any {
  return JSON.parse(JSON.stringify(value ?? null)) as any;
}

@Injectable()
export class GapAnalysisService {
  private readonly logger = new Logger(GapAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly technicalAudit: TechnicalAuditCollector,
    private readonly socialActivity: SocialActivityCollector,
    private readonly aeoAudit: AeoAuditCollector,
    private readonly generation: GapAnalysisGenerationService,
  ) {}

  /**
   * Collects whatever source runs exist, consolidates them into a ranked
   * list, and persists. 409 when zero of the three sources have a
   * completed run — nothing to consolidate — or when the LLM's proposal
   * fails to clear the minimum-count guardrail after grounding drops.
   */
  async run(clientId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null } });
    if (!project) throw new NotFoundException('Project not found.');

    const [technicalAuditSource, socialActivitySource, aeoAuditSource] = await Promise.all([
      this.technicalAudit.collect(clientId, projectId),
      this.socialActivity.collect(clientId, projectId),
      this.aeoAudit.collect(clientId, projectId),
    ]);

    const sources = [technicalAuditSource, socialActivitySource, aeoAuditSource].filter((s): s is CollectedSource => s !== null);
    if (sources.length === 0) {
      throw new ConflictException('No completed run exists yet from Technical Audit, Social Activity, or AEO Audit — nothing to consolidate.');
    }

    const allFindings: SourceFinding[] = sources.flatMap((s) => s.findings);

    const run = await this.prisma.gapAnalysisRun.create({
      data: {
        projectId,
        status: 'RUNNING',
        sourceTechnicalAuditRunId: technicalAuditSource?.runId ?? null,
        sourceSocialActivityRunId: socialActivitySource?.runId ?? null,
        sourceAeoAuditId: aeoAuditSource?.runId ?? null,
      },
    });

    try {
      const raw = await this.generation.consolidate(allFindings);
      const { kept, notes: groundingNotes } = rejectUngroundedRecommendations(raw, allFindings);

      const countNotes = checkRecommendationCount(kept);
      if (countNotes.length > 0) {
        await this.prisma.gapAnalysisRun.update({
          where: { id: run.id },
          data: { status: 'FAILED', error: countNotes.map((n) => n.detail).join(' '), completedAt: new Date() },
        });
        throw new ConflictException(
          `Consolidation rejected: ${countNotes.map((n) => n.detail).join(' ')} Try again — consolidation is non-deterministic. ${groundingNotes.length} recommendation(s) were dropped for ungrounded citations or fabricated numbers.`,
        );
      }

      const validated = assignRanks(kept);

      await this.prisma.$transaction(async (tx) => {
        for (const rec of validated) {
          await tx.gapAnalysisRecommendation.create({
            data: {
              gapAnalysisRunId: run.id,
              title: rec.title,
              description: rec.description,
              priorityRank: rec.priorityRank,
              sourceFindings: asJson(rec.sourceFindings),
            },
          });
        }
        await tx.gapAnalysisRun.update({ where: { id: run.id }, data: { status: 'COMPLETE', completedAt: new Date() } });
      });

      this.logger.log(`Gap analysis run ${run.id}: ${validated.length} recommendations from ${sources.length} source(s), ${groundingNotes.length} dropped.`);
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Gap analysis run ${run.id} failed: ${message}`);
      await this.prisma.gapAnalysisRun.update({ where: { id: run.id }, data: { status: 'FAILED', error: message, completedAt: new Date() } });
      throw err;
    }

    return this.getRun(clientId, run.id);
  }

  async listRuns(clientId: string, projectId: string) {
    await this.assertProjectInClient(projectId, clientId);
    return this.prisma.gapAnalysisRun.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
  }

  async getRun(clientId: string, runId: string) {
    const run = await this.prisma.gapAnalysisRun.findFirst({
      where: { id: runId, project: { clientId, deletedAt: null } },
      include: { recommendations: { orderBy: { priorityRank: 'asc' } } },
    });
    if (!run) throw new NotFoundException('Run not found.');
    return run;
  }

  /** Updates a recommendation's status only — operator-tracked, never regenerated. */
  async setRecommendationStatus(clientId: string, recommendationId: string, status: 'OPEN' | 'DONE' | 'DISMISSED') {
    const rec = await this.prisma.gapAnalysisRecommendation.findFirst({
      where: { id: recommendationId, run: { project: { clientId, deletedAt: null } } },
    });
    if (!rec) throw new NotFoundException('Recommendation not found.');
    return this.prisma.gapAnalysisRecommendation.update({ where: { id: recommendationId }, data: { status } });
  }

  private async assertProjectInClient(projectId: string, clientId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundException('Project not found.');
  }
}
