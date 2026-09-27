import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { Role } from '../../../generated/prisma/enums.js';
import { CreateMeasurementRunDto } from '../dto/measurement.dto.js';
import { MeasurementService } from '../services/measurement.service.js';

/**
 * Staff-facing measurement management, nested under a project — mirrors
 * Query Set's own controller split (project-nested creation/list/summary,
 * a run-id-scoped route for execute since a run id is globally unique).
 * Admin-triggered: measuring an active query set spends real Cloro credit.
 */
@Controller('team/clients/:clientId/projects/:projectId/measurement')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class MeasurementController {
  constructor(private readonly measurement: MeasurementService) {}

  /** POST …/runs — create a run against an ACTIVE query set. Admin-only. */
  @Post('runs')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  createRun(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Body() dto: CreateMeasurementRunDto) {
    return this.measurement.createRun(clientId, projectId, dto);
  }

  /** GET …/runs — this project's runs, newest first. `?surface=` filters. */
  @Get('runs')
  @RequirePermission('view_projects')
  listRuns(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Query('surface') surface?: string) {
    return this.measurement.listRuns(clientId, projectId, surface);
  }

  /** GET …/summary — aggregate rates. `?runId=` scopes to one run's cohort. */
  @Get('summary')
  @RequirePermission('view_projects')
  summary(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Query('runId') runId?: string) {
    return this.measurement.summary(clientId, projectId, runId);
  }
}

/** Run-id-scoped route: execute + read a run. A run id is globally unique and unguessable. */
@Controller('team/clients/:clientId/measurement-runs/:runId')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class MeasurementRunController {
  constructor(private readonly measurement: MeasurementService) {}

  /** POST …/execute — runs every prompt x n against the surface. Admin-only, spends real credit. */
  @Post('execute')
  @Roles(Role.ADMIN)
  execute(@Param('clientId') clientId: string, @Param('runId') runId: string) {
    return this.measurement.executeRun(runId);
  }

  /** GET — one run + its observations. */
  @Get()
  @RequirePermission('view_projects')
  getRun(@Param('clientId') clientId: string, @Param('runId') runId: string) {
    return this.measurement.getRun(clientId, runId);
  }
}
