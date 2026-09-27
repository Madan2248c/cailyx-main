import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Role } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { AccessTokenPayload } from '../../../common/jwt/access-token-payload.js';
import { Day1PipelineService } from '../../day1-pipeline/services/day1-pipeline.service.js';
import type { CreateProjectDto } from '../dto/create-project.dto.js';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly day1: Day1PipelineService,
  ) {}

  /** Creates a project under a client. Caller must be ADMIN (enforced by the controller's guard). */
  async createProject(clientId: string, dto: CreateProjectDto, adminId: string) {
    await this.getClientOrThrow(clientId);

    const domain = this.normalizeDomain(dto.domain);
    const existing = await this.prisma.project.findFirst({
      where: { clientId, domain, deletedAt: null },
    });
    if (existing) {
      throw new BadRequestException('This client already has an active project on this domain.');
    }

    const project = await this.prisma.project.create({
      data: { clientId, name: dto.name, domain, createdBy: adminId },
    });

    // The Day-1 pipeline starts here, in the same request: creating a
    // project is the trigger (spend pre-authorized by dto.day1SpendConsent),
    // and there is no client-facing step between the two. The pipeline row
    // is created and the job enqueued by Day1PipelineService — a direct
    // call rather than an event bus, same reasoning as before (one
    // consumer). See docs/analysis/day1-pipeline.md §5.
    //
    // Deliberately non-fatal: a project must be creatable even if the job
    // queue is unreachable. `startPipeline` records the failure on the
    // pipeline row instead of throwing, so the failure is visible without
    // blocking project creation.
    await this.day1
      .startPipeline(clientId, project.id, { spendCeilingUsd: dto.day1SpendCeilingUsd })
      .catch((err: unknown) => {
        this.logger.error(
          `Project ${project.id} was created, but its Day-1 pipeline could not be started: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

    return this.publicProject(project);
  }

  /**
   * Lists a client's non-deleted projects, newest first. ADMIN can list any
   * client's projects; anyone else must be scoped to their own client (see
   * docs/analysis/projects.md — `view_projects` permission).
   */
  async listProjects(clientId: string, caller: AccessTokenPayload) {
    await this.getClientOrThrow(clientId);
    this.assertCanView(clientId, caller);

    const projects = await this.prisma.project.findMany({
      where: { clientId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    return projects.map((project) => this.publicProject(project));
  }

  /** Soft-deletes ("archives") a project. Admin-only (enforced by the controller's guard). */
  async archiveProject(clientId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, clientId, deletedAt: null },
    });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    await this.prisma.project.update({
      where: { id: project.id },
      data: { deletedAt: new Date() },
    });

    return { success: true };
  }

  /**
   * Day-1 pipeline status for a project. Admin-only (enforced by the
   * controller's guard) — pipeline recovery is an operator concern.
   */
  async getDay1Status(clientId: string, projectId: string) {
    await this.getProjectOrThrow(clientId, projectId);
    return this.day1.getStatus(clientId, projectId);
  }

  /**
   * Re-enqueues a stalled or failed Day-1 pipeline. Admin-only. Rejects
   * COMPLETE/RUNNING rows — retrying those would double-spend.
   */
  async retryDay1Pipeline(clientId: string, projectId: string) {
    await this.getProjectOrThrow(clientId, projectId);
    return this.day1.retry(clientId, projectId);
  }

  private async getProjectOrThrow(clientId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, clientId, deletedAt: null },
    });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }
    return project;
  }

  private assertCanView(clientId: string, caller: AccessTokenPayload): void {
    if (caller.role === Role.ADMIN) {
      return;
    }
    if (caller.clientId !== clientId) {
      throw new ForbiddenException('You do not have access to this client.');
    }
  }

  private async getClientOrThrow(clientId: string) {
    const client = await this.prisma.client.findFirst({ where: { id: clientId, deletedAt: null } });
    if (!client) {
      throw new NotFoundException('Client not found.');
    }
    return client;
  }

  /**
   * Normalizes a domain the same way for every insert/lookup — see
   * docs/analysis/projects.md for the exact rule: lowercase, strip
   * protocol/www, keep only the hostname, drop a trailing dot/slash.
   */
  private normalizeDomain(input: string): string {
    let domain = input.trim().toLowerCase();
    domain = domain.replace(/^https?:\/\//, '');
    domain = domain.replace(/^www\./, '');
    domain = domain.split(/[/?#]/)[0]!;
    domain = domain.replace(/[./]+$/, '');
    return domain;
  }

  private publicProject(project: {
    id: string;
    clientId: string;
    name: string;
    domain: string;
    createdAt: Date;
  }) {
    return {
      id: project.id,
      clientId: project.clientId,
      name: project.name,
      domain: project.domain,
      createdAt: project.createdAt,
    };
  }
}
