/**
 * Competitor list — the single source of truth stance judging reads to
 * decide whether a named rival counts as `recommendedOver`/`losesTo`
 * (deliberately not the old repo's design: a seed JSON column on Project
 * that never synced with a separate candidates table). An operator seeds
 * `tracked` rows manually; stance judging writes `candidate` rows for
 * names it saw that matched nothing known, confirmable here.
 *
 * @module aeo-audit/services/competitor.service
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';

@Injectable()
export class CompetitorService {
  constructor(private readonly prisma: PrismaService) {}

  async list(clientId: string, projectId: string) {
    await this.assertProjectInClient(projectId, clientId);
    return this.prisma.competitor.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
  }

  async create(clientId: string, projectId: string, input: { name: string; domain?: string }) {
    await this.assertProjectInClient(projectId, clientId);
    return this.prisma.competitor.create({
      data: { projectId, name: input.name, domain: input.domain, status: 'tracked', source: 'manual' },
    });
  }

  /** Promotes a stance-discovered `candidate` to `tracked` — or demotes back. Never deletes: a rejected candidate stays visible as history. */
  async setStatus(clientId: string, competitorId: string, status: 'tracked' | 'candidate') {
    const row = await this.prisma.competitor.findFirst({ where: { id: competitorId, project: { clientId, deletedAt: null } } });
    if (!row) throw new NotFoundException('Competitor not found.');
    return this.prisma.competitor.update({ where: { id: competitorId }, data: { status } });
  }

  /**
   * Every name stance judging is allowed to attribute a rivalry to
   * (`tracked` + `candidate` both count — a candidate is a known name,
   * just not yet operator-confirmed as worth tracking long-term).
   */
  async knownNames(projectId: string): Promise<string[]> {
    const rows = await this.prisma.competitor.findMany({ where: { projectId }, select: { name: true } });
    return rows.map((r) => r.name);
  }

  /** Upserts a stance-discovered name as a `candidate` — never overwrites an existing `tracked` row's status. */
  async recordCandidate(projectId: string, name: string): Promise<void> {
    const existing = await this.prisma.competitor.findFirst({ where: { projectId, name } });
    if (existing) return;
    await this.prisma.competitor.create({ data: { projectId, name, status: 'candidate', source: 'stance_discovered' } });
  }

  private async assertProjectInClient(projectId: string, clientId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, clientId, deletedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundException('Project not found.');
  }
}
