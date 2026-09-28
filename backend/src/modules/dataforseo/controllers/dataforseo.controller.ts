import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { ClientScopeGuard } from '../../../common/guards/client-scope.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { Role } from '../../../generated/prisma/enums.js';
import { CollectDataforseoDto, SetDataforseoScheduleDto } from '../dto/dataforseo.dto.js';
import { DataforseoScheduler } from '../services/dataforseo.scheduler.js';
import { DataforseoService } from '../services/dataforseo.service.js';

/**
 * Staff-facing inspection of the DataForSEO pipeline, nested under a
 * project the same way the Technical Audit and Social Activity
 * controllers are.
 *
 * Admin-triggered and read-mostly: there is no client-facing trigger —
 * a collect runs when an admin calls it (mock-only spend in this build),
 * or when an opted-in project's schedule fires. Snapshots are
 * append-only and read-only: no update/delete endpoint exists on purpose.
 */
@Controller('team/clients/:clientId/projects/:projectId')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, ClientScopeGuard)
export class DataforseoController {
  constructor(
    private readonly dataforseo: DataforseoService,
    private readonly schedules: DataforseoScheduler,
  ) {}

  /** POST …/dataforseo-collect — collect one snapshot per dataset now. Admin-only. */
  @Post('dataforseo-collect')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  collectNow(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Body() dto: CollectDataforseoDto) {
    return this.dataforseo.collectNow(clientId, projectId, dto.datasets);
  }

  /** GET …/dataforseo-snapshots — this project's snapshots, newest first. `?dataset=` filters. */
  @Get('dataforseo-snapshots')
  @RequirePermission('view_projects')
  listSnapshots(
    @Param('clientId') clientId: string,
    @Param('projectId') projectId: string,
    @Query('dataset') dataset?: string,
  ) {
    return this.dataforseo.listSnapshots(clientId, projectId, dataset);
  }

  /** PUT …/dataforseo-schedule — set cadence + datasets + spend opt-in. Admin-only. */
  @Put('dataforseo-schedule')
  @Roles(Role.ADMIN)
  setSchedule(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Body() dto: SetDataforseoScheduleDto) {
    return this.schedules.setSchedule(clientId, projectId, dto);
  }

  /** GET …/dataforseo-schedule — current schedule + config, or null when never set. */
  @Get('dataforseo-schedule')
  @RequirePermission('view_projects')
  getSchedule(@Param('clientId') clientId: string, @Param('projectId') projectId: string) {
    return this.schedules.getSchedule(clientId, projectId);
  }
}

/**
 * Snapshot inspection is keyed by snapshot id alone (globally unique and
 * unguessable) — the service still scopes it to the caller's client.
 */
@Controller('team/clients/:clientId/dataforseo-snapshots')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, ClientScopeGuard)
export class DataforseoSnapshotController {
  constructor(private readonly dataforseo: DataforseoService) {}

  /** GET — one snapshot: dataset, period, payload, cost. Read-only by design. */
  @Get(':snapshotId')
  @RequirePermission('view_projects')
  getSnapshot(@Param('clientId') clientId: string, @Param('snapshotId') snapshotId: string) {
    return this.dataforseo.getSnapshot(clientId, snapshotId);
  }
}
