import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { ClientScopeGuard } from '../../../common/guards/client-scope.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { Role } from '../../../generated/prisma/enums.js';
import { CreateAeoAuditDto, CreateCompetitorDto, SetCompetitorStatusDto } from '../dto/aeo-audit.dto.js';
import { AeoAuditService } from '../services/aeo-audit.service.js';
import { CompetitorService } from '../services/competitor.service.js';

/**
 * Staff-facing AEO audit management, nested under a project — mirrors
 * Measurement's own controller split. Admin-triggered: `run` spends real
 * Cloro credit and LLM tokens across every surface x market pair.
 */
@Controller('team/clients/:clientId/projects/:projectId/aeo-audits')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, ClientScopeGuard)
export class AeoAuditController {
  constructor(private readonly audits: AeoAuditService) {}

  /** POST — create an audit against an ACTIVE query set. Cheap, no spend. Admin-only. */
  @Post()
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Body() dto: CreateAeoAuditDto) {
    return this.audits.create(clientId, projectId, dto);
  }

  /** GET — this project's audits, newest first. */
  @Get()
  @RequirePermission('view_projects')
  list(@Param('clientId') clientId: string, @Param('projectId') projectId: string) {
    return this.audits.list(clientId, projectId);
  }
}

/** Audit-id-scoped routes: run, read, verdict, narrative. A globally unique, unguessable id. */
@Controller('team/clients/:clientId/aeo-audits/:auditId')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, ClientScopeGuard)
export class AeoAuditRunController {
  constructor(private readonly audits: AeoAuditService) {}

  /** POST …/run — drives every pending surface run to completion, judges stance, builds the verdict. Spends real credit. Admin-only. Resumable. */
  @Post('run')
  @Roles(Role.ADMIN)
  run(@Param('clientId') clientId: string, @Param('auditId') auditId: string) {
    return this.audits.run(clientId, auditId);
  }

  /** GET — one audit + its surface runs. */
  @Get()
  @RequirePermission('view_projects')
  getAudit(@Param('clientId') clientId: string, @Param('auditId') auditId: string) {
    return this.audits.getAudit(clientId, auditId);
  }

  /** GET …/verdict — recomputed fresh from stored rows. Cheap, no spend. */
  @Get('verdict')
  @RequirePermission('view_projects')
  getVerdict(@Param('clientId') clientId: string, @Param('auditId') auditId: string) {
    return this.audits.getVerdict(clientId, auditId);
  }

  /** POST …/narrative — regenerate narrative on demand. Admin-only, spends a small amount of LLM tokens. */
  @Post('narrative')
  @Roles(Role.ADMIN)
  regenerateNarrative(@Param('clientId') clientId: string, @Param('auditId') auditId: string) {
    return this.audits.regenerateNarrative(clientId, auditId);
  }
}

/** Competitor list, nested under a project — the source of truth stance judging reads. */
@Controller('team/clients/:clientId/projects/:projectId/competitors')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, ClientScopeGuard)
export class CompetitorController {
  constructor(private readonly competitors: CompetitorService) {}

  @Get()
  @RequirePermission('view_projects')
  list(@Param('clientId') clientId: string, @Param('projectId') projectId: string) {
    return this.competitors.list(clientId, projectId);
  }

  @Post()
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Body() dto: CreateCompetitorDto) {
    return this.competitors.create(clientId, projectId, dto);
  }
}

/** Competitor-id-scoped: confirm/demote a candidate. */
@Controller('team/clients/:clientId/competitors/:id')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, ClientScopeGuard)
export class CompetitorItemController {
  constructor(private readonly competitors: CompetitorService) {}

  @Post('status')
  @Roles(Role.ADMIN)
  setStatus(@Param('clientId') clientId: string, @Param('id') id: string, @Body() dto: SetCompetitorStatusDto) {
    return this.competitors.setStatus(clientId, id, dto.status);
  }
}
