import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { ClientScopeGuard } from '../../../common/guards/client-scope.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { Role } from '../../../generated/prisma/enums.js';
import { SetTechnicalAuditScheduleDto } from '../dto/technical-audit.dto.js';
import { TechnicalAuditScheduler } from '../services/technical-audit.scheduler.js';
import { TechnicalAuditService } from '../services/technical-audit.service.js';

/**
 * Staff-facing inspection of the technical-audit pipeline, nested under a
 * project the same way the Projects and Discovery controllers are nested
 * under a client.
 *
 * Deliberately **admin-triggered and read-mostly**: there is no
 * client-facing trigger for this module — an audit starts when an admin
 * queues one (or when a project's WEEKLY/MONTHLY schedule fires), and the
 * run itself executes on the background queue, never inside the HTTP call.
 */
@Controller('team/clients/:clientId/projects/:projectId')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, ClientScopeGuard)
export class TechnicalAuditController {
  constructor(
    private readonly audits: TechnicalAuditService,
    private readonly schedules: TechnicalAuditScheduler,
  ) {}

  /** POST …/technical-audit-runs — queue an audit for this project. Admin-only. */
  @Post('technical-audit-runs')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  rerun(@Param('clientId') clientId: string, @Param('projectId') projectId: string) {
    return this.audits.rerun(clientId, projectId);
  }

  /** GET …/technical-audit-runs — this project's run history, newest first. */
  @Get('technical-audit-runs')
  @RequirePermission('view_projects')
  listRuns(@Param('clientId') clientId: string, @Param('projectId') projectId: string) {
    return this.audits.listRuns(clientId, projectId);
  }

  /** GET …/technical-audit-trend — score history, oldest first. */
  @Get('technical-audit-trend')
  @RequirePermission('view_projects')
  getTrend(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Query('limit') limit?: string) {
    return this.audits.getTrend(clientId, projectId, Number(limit) || 30);
  }

  /** PUT …/technical-audit-schedule — set WEEKLY/MONTHLY/MANUAL_ONLY. Admin-only. */
  @Put('technical-audit-schedule')
  @Roles(Role.ADMIN)
  setSchedule(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Body() dto: SetTechnicalAuditScheduleDto) {
    return this.schedules.setSchedule(clientId, projectId, dto.cadence);
  }

  /** GET …/technical-audit-schedule — current cadence, or null when never set. */
  @Get('technical-audit-schedule')
  @RequirePermission('view_projects')
  getSchedule(@Param('clientId') clientId: string, @Param('projectId') projectId: string) {
    return this.schedules.getSchedule(clientId, projectId);
  }
}

/**
 * Run inspection is keyed by run id alone (a run id is globally unique and
 * unguessable), so it lives on its own route rather than nested twice — the
 * service still scopes it to the caller's client.
 */
@Controller('team/clients/:clientId/technical-audit-runs')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, ClientScopeGuard)
export class TechnicalAuditRunController {
  constructor(private readonly audits: TechnicalAuditService) {}

  /** GET — one run: score, findings, deltas, narrative, worst pages first. */
  @Get(':runId')
  @RequirePermission('view_projects')
  getRun(@Param('clientId') clientId: string, @Param('runId') runId: string) {
    return this.audits.getRun(clientId, runId);
  }

  /** GET — previous-vs-current comparison for one run. */
  @Get(':runId/comparison')
  @RequirePermission('view_projects')
  getComparison(@Param('clientId') clientId: string, @Param('runId') runId: string) {
    return this.audits.getComparison(clientId, runId);
  }
}
