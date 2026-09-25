import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import type { AccessTokenPayload } from '../../../common/jwt/access-token-payload.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { Role } from '../../../generated/prisma/enums.js';
import { CreateProjectDto } from '../dto/create-project.dto.js';
import { ProjectsService } from '../services/projects.service.js';

/**
 * Nested under a client (see docs/analysis/projects.md for why): every
 * project operation is inherently scoped to a client, so the URL carries
 * that scope instead of the request body.
 */
@Controller('team/clients/:clientId/projects')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  /** POST /team/clients/:clientId/projects — create a project. Admin-only. */
  @Post()
  @Roles(Role.ADMIN)
  createProject(
    @Param('clientId') clientId: string,
    @Body() dto: CreateProjectDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.projectsService.createProject(clientId, dto, user.sub);
  }

  /** GET /team/clients/:clientId/projects — list a client's projects. Admin, or that client's own POC/members. */
  @Get()
  @RequirePermission('view_projects')
  listProjects(@Param('clientId') clientId: string, @CurrentUser() user: AccessTokenPayload) {
    return this.projectsService.listProjects(clientId, user);
  }

  /** PATCH /team/clients/:clientId/projects/:id/archive — soft-delete a project. Admin-only. */
  @Patch(':id/archive')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  archiveProject(@Param('clientId') clientId: string, @Param('id') id: string) {
    return this.projectsService.archiveProject(clientId, id);
  }
}
