import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { Role } from '../../../generated/prisma/enums.js';
import { CreateCompetitorDto } from '../dto/competitors.dto.js';
import { CompetitorsService } from '../services/competitors.service.js';

/**
 * Staff-facing competitor tracking, nested under a project. Un-tracking a
 * competitor reuses AEO Audit's existing `Competitor.status` endpoint — no
 * duplicate status route here.
 */
@Controller('team/clients/:clientId/projects/:projectId/competitors')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class CompetitorsController {
  constructor(private readonly competitors: CompetitorsService) {}

  /** POST …/discover — SERP discovery + AEO's existing rows, profiles every tracked competitor + the project's own domain. Admin-only, spends a small DataForSEO query cost. */
  @Post('discover')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  discover(@Param('clientId') clientId: string, @Param('projectId') projectId: string) {
    return this.competitors.discover(clientId, projectId);
  }

  /** POST — manual add fallback. Admin-only. */
  @Post()
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Body() dto: CreateCompetitorDto) {
    return this.competitors.create(clientId, projectId, dto);
  }

  /** GET — tracked competitors + each one's latest profile. */
  @Get()
  @RequirePermission('view_projects')
  list(@Param('clientId') clientId: string, @Param('projectId') projectId: string) {
    return this.competitors.list(clientId, projectId);
  }

  /** GET …/gap — deterministic client-vs-competitor comparison. No LLM. */
  @Get('gap')
  @RequirePermission('view_projects')
  getGap(@Param('clientId') clientId: string, @Param('projectId') projectId: string) {
    return this.competitors.getGap(clientId, projectId);
  }
}
