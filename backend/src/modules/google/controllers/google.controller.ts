/**
 * Google controllers — consent links, connection status, and the public
 * OAuth callback. Project-scoped data reads live next to these.
 */

import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { ConnectQueryDto, DaysQueryDto } from '../dto/google.dto.js';
import { GoogleService } from '../google.service.js';

@Controller('team/clients/:clientId/google')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class GoogleController {
  constructor(private readonly google: GoogleService) {}

  /** GET …/google/connect-url?provider=gsc|ga — consent link. POC-only. */
  @Get('connect-url')
  @RequirePermission('manage_client_settings')
  connectUrl(@Param('clientId') clientId: string, @Query() query: ConnectQueryDto) {
    return this.google.connectUrl(clientId, query.provider);
  }

  /** GET …/google/status — which providers are linked. */
  @Get('status')
  @RequirePermission('view_projects')
  status(@Param('clientId') clientId: string) {
    return this.google.getStatus(clientId);
  }

  /** POST …/google/disconnect — revoke at Google, delete the row. POC-only. */
  @Post('disconnect')
  @RequirePermission('manage_client_settings')
  @HttpCode(HttpStatus.OK)
  disconnect(@Param('clientId') clientId: string) {
    return this.google.disconnect(clientId);
  }
}

@Controller('team/clients/:clientId/projects/:projectId/google')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class GoogleProjectController {
  constructor(private readonly google: GoogleService) {}

  /** GET …/google/search-console?days=28 — live GSC overview. */
  @Get('search-console')
  @RequirePermission('view_projects')
  searchConsole(
    @Param('clientId') clientId: string,
    @Param('projectId') projectId: string,
    @Query() query: DaysQueryDto,
  ) {
    return this.google.getSearchConsole(clientId, projectId, query.days ?? 28);
  }

  /** GET …/google/analytics?days=28 — live GA4 overview. */
  @Get('analytics')
  @RequirePermission('view_projects')
  analytics(
    @Param('clientId') clientId: string,
    @Param('projectId') projectId: string,
    @Query() query: DaysQueryDto,
  ) {
    return this.google.getAnalytics(clientId, projectId, query.days ?? 28);
  }
}

/**
 * The OAuth landing point Google redirects to — public by necessity
 * (Google calls it, not our frontend). The signed `state` carries the
 * client attribution; afterwards the browser lands back in the workspace.
 */
@Controller('auth/google')
export class GoogleCallbackController {
  constructor(private readonly google: GoogleService) {}

  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    try {
      await this.google.handleCallback(code, state);
      res.redirect(`${this.google.frontendUrl()}/client?google=connected`);
    } catch {
      res.redirect(`${this.google.frontendUrl()}/client?google=error`);
    }
  }
}
