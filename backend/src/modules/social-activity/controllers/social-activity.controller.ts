import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { ClientScopeGuard } from '../../../common/guards/client-scope.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { Role } from '../../../generated/prisma/enums.js';
import { SetSocialActivityScheduleDto, TriggerSocialActivityRunDto } from '../dto/social-activity.dto.js';
import { SocialActivityScheduler } from '../services/social-activity.scheduler.js';
import { SocialActivityService } from '../services/social-activity.service.js';

/**
 * Staff-facing inspection of the social-activity pipeline, nested under a
 * project the same way the Technical Audit controllers are.
 *
 * Deliberately **admin-triggered and read-mostly**: there is no
 * client-facing trigger — a run starts when an admin queues one with
 * explicit `confirmSpend: true` (or when an opted-in project's schedule
 * fires), and the run itself executes on the background queue, never inside
 * the HTTP call.
 */
@Controller('team/clients/:clientId/projects/:projectId')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, ClientScopeGuard)
export class SocialActivityController {
  constructor(
    private readonly activity: SocialActivityService,
    private readonly schedules: SocialActivityScheduler,
  ) {}

  /** POST …/social-activity-runs — queue a pull for this project. Admin-only, spend-gated. */
  @Post('social-activity-runs')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  rerun(
    @Param('clientId') clientId: string,
    @Param('projectId') projectId: string,
    @Body() dto: TriggerSocialActivityRunDto,
  ) {
    return this.activity.rerun(clientId, projectId, dto);
  }

  /** GET …/social-activity-runs — this project's run history, newest first. */
  @Get('social-activity-runs')
  @RequirePermission('view_projects')
  listRuns(@Param('clientId') clientId: string, @Param('projectId') projectId: string) {
    return this.activity.listRuns(clientId, projectId);
  }

  /** PUT …/social-activity-schedule — set cadence + config. Admin-only. */
  @Put('social-activity-schedule')
  @Roles(Role.ADMIN)
  setSchedule(
    @Param('clientId') clientId: string,
    @Param('projectId') projectId: string,
    @Body() dto: SetSocialActivityScheduleDto,
  ) {
    return this.schedules.setSchedule(clientId, projectId, dto);
  }

  /** GET …/social-activity-schedule — current schedule + config, or null when never set. */
  @Get('social-activity-schedule')
  @RequirePermission('view_projects')
  getSchedule(@Param('clientId') clientId: string, @Param('projectId') projectId: string) {
    return this.schedules.getSchedule(clientId, projectId);
  }
}

/**
 * Run inspection is keyed by run id alone (globally unique and
 * unguessable) — the service still scopes it to the caller's client.
 */
@Controller('team/clients/:clientId/social-activity-runs')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, ClientScopeGuard)
export class SocialActivityRunController {
  constructor(private readonly activity: SocialActivityService) {}

  /** GET — one run: per-platform aggregates, findings, deltas, narrative. */
  @Get(':runId')
  @RequirePermission('view_projects')
  getRun(@Param('clientId') clientId: string, @Param('runId') runId: string) {
    return this.activity.getRun(clientId, runId);
  }

  /** GET — previous-vs-current comparison for one run. */
  @Get(':runId/comparison')
  @RequirePermission('view_projects')
  getComparison(@Param('clientId') clientId: string, @Param('runId') runId: string) {
    return this.activity.getComparison(clientId, runId);
  }
}
