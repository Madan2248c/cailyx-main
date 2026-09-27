import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { Role } from '../../../generated/prisma/enums.js';
import { SetRecommendationStatusDto } from '../dto/gap-analysis.dto.js';
import { GapAnalysisService } from '../services/gap-analysis.service.js';

/**
 * Staff-facing gap-analysis management, nested under a project — mirrors
 * every other module's own controller split. Admin-triggered: `run`
 * spends one LLM call.
 */
@Controller('team/clients/:clientId/projects/:projectId/gap-analysis')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class GapAnalysisController {
  constructor(private readonly gapAnalysis: GapAnalysisService) {}

  /** POST …/runs — consolidate the latest available source runs. 409 if none exist. Admin-only. */
  @Post('runs')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  run(@Param('clientId') clientId: string, @Param('projectId') projectId: string) {
    return this.gapAnalysis.run(clientId, projectId);
  }

  /** GET …/runs — this project's runs, newest first. */
  @Get('runs')
  @RequirePermission('view_projects')
  listRuns(@Param('clientId') clientId: string, @Param('projectId') projectId: string) {
    return this.gapAnalysis.listRuns(clientId, projectId);
  }
}

/** Run-id-scoped: read one run + its ranked recommendations. A globally unique, unguessable id. */
@Controller('team/clients/:clientId/gap-analysis/runs/:id')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class GapAnalysisRunController {
  constructor(private readonly gapAnalysis: GapAnalysisService) {}

  @Get()
  @RequirePermission('view_projects')
  getRun(@Param('clientId') clientId: string, @Param('id') id: string) {
    return this.gapAnalysis.getRun(clientId, id);
  }
}

/** Recommendation-id-scoped: update status only. */
@Controller('team/clients/:clientId/gap-analysis/recommendations/:id')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class GapAnalysisRecommendationController {
  constructor(private readonly gapAnalysis: GapAnalysisService) {}

  @Patch()
  @Roles(Role.ADMIN)
  setStatus(@Param('clientId') clientId: string, @Param('id') id: string, @Body() dto: SetRecommendationStatusDto) {
    return this.gapAnalysis.setRecommendationStatus(clientId, id, dto.status);
  }
}
