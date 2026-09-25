import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { Role } from '../../../generated/prisma/enums.js';
import { DiscoveryService } from '../services/discovery.service.js';

/**
 * Staff-facing inspection of the discovery pipeline, nested under a project the
 * same way the Projects controller is nested under a client.
 *
 * Deliberately **admin-only and read-mostly**: there is no client-facing trigger
 * for this module (docs/analysis/discovery.md "Trigger") — discovery starts when
 * an admin creates a project, and no email or client-visible state exists until
 * the Day-1 report module is built. What an operator needs meanwhile is the
 * ability to see why a profile looks wrong, and to re-run one.
 */
@Controller('team/clients/:clientId/projects/:projectId')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  /** POST …/discovery-runs — queue a fresh discovery run for this project. Admin-only. */
  @Post('discovery-runs')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  rerun(@Param('clientId') clientId: string, @Param('projectId') projectId: string) {
    return this.discovery.rerun(clientId, projectId);
  }

  /** GET …/discovery-runs — this project's run history, newest first. */
  @Get('discovery-runs')
  @RequirePermission('view_projects')
  listRuns(@Param('clientId') clientId: string, @Param('projectId') projectId: string) {
    return this.discovery.listRuns(clientId, projectId);
  }

  /** GET …/company-context — the current enriched profile, or null when none exists. */
  @Get('company-context')
  @RequirePermission('view_projects')
  latestProfile(@Param('clientId') clientId: string, @Param('projectId') projectId: string) {
    return this.discovery.latestProfile(clientId, projectId);
  }

  /** GET …/social-profiles — verified/candidate social profiles, best-verified first. */
  @Get('social-profiles')
  @RequirePermission('view_projects')
  listSocialProfiles(@Param('clientId') clientId: string, @Param('projectId') projectId: string) {
    return this.discovery.listSocialProfiles(clientId, projectId);
  }
}

/**
 * Run inspection is keyed by run id alone (a run id is globally unique and
 * unguessable), so it lives on its own route rather than nested twice — the
 * service still scopes it to the caller's client.
 */
@Controller('team/clients/:clientId/discovery-runs')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class DiscoveryRunController {
  constructor(private readonly discovery: DiscoveryService) {}

  /** GET — one run: status, stage, budgets, notes, and every page it considered. */
  @Get(':runId')
  @RequirePermission('view_projects')
  getRun(@Param('clientId') clientId: string, @Param('runId') runId: string) {
    return this.discovery.getRun(clientId, runId);
  }
}
