import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Role } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { AccessTokenPayload } from '../../../common/jwt/access-token-payload.js';
import { DiscoveryService } from '../../discovery/services/discovery.service.js';
import type { CreateProjectDto } from '../dto/create-project.dto.js';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly discovery: DiscoveryService,
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

    // Discovery (Stage 1 of the Day-1 pipeline) starts here, in the same
    // request: creating a project is the trigger, and there is no client-facing
    // step between the two. A direct call rather than an event bus — there is
    // one consumer, and a same-transaction call is simpler and equally correct
    // until a second module needs to react to project creation. See
    // docs/analysis/discovery.md "Trigger".
    //
    // Deliberately non-fatal: a project must be creatable even if the job queue
    // is unreachable. `startRun` records the failure on the run row instead of
    // throwing, so the failure is visible without blocking project creation.
    await this.discovery.startRun(project.id).catch((err: unknown) => {
      this.logger.error(
        `Project ${project.id} was created, but its discovery run could not be started: ${
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
