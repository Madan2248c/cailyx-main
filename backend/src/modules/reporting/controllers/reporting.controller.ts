import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { ClientScopeGuard } from '../../../common/guards/client-scope.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import type { AccessTokenPayload } from '../../../common/jwt/access-token-payload.js';
import { Role } from '../../../generated/prisma/enums.js';
import { ApproveReportDto, EditReportDto, GenerateReportDto } from '../dto/reporting.dto.js';
import { BrowserClientService } from '../../fetcher/clients/browser-client.service.js';
import { ReportingService } from '../services/reporting.service.js';

/**
 * Staff-facing report generation, nested under a project. `DAY1` is
 * normally triggered by the Day-1 pipeline's own final step, not called
 * directly here — the endpoint exists for retries.
 */
@Controller('team/clients/:clientId/projects/:projectId/reports')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, ClientScopeGuard)
export class ReportsController {
  constructor(private readonly reporting: ReportingService) {}

  @Post()
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  generate(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Body() dto: GenerateReportDto) {
    return this.reporting.generate(clientId, projectId, dto.kind);
  }

  @Get()
  @RequirePermission('view_projects')
  list(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Query('kind') kind?: 'DAY1' | 'MONTHLY') {
    return this.reporting.list(clientId, projectId, kind);
  }
}

/** Report-id-scoped: read, editorial lifecycle, share links. A globally unique, unguessable id. */
@Controller('team/clients/:clientId/reports/:id')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, ClientScopeGuard)
export class ReportController {
  constructor(
    private readonly reporting: ReportingService,
    private readonly browser: BrowserClientService,
  ) {}

  @Get()
  @RequirePermission('view_projects')
  getOne(@Param('clientId') clientId: string, @Param('id') id: string) {
    return this.reporting.getOne(clientId, id);
  }

  /**
   * GET …/pdf — "Download report". The same content and access rule as
   * `GET` above, printed as the Day-1 diagnostic PDF (dark cover, numbered
   * sections) by the shared Playwright printer the Fix Plan PDF uses.
   * `?format=html` returns the print HTML instead, for checking the layout.
   */
  @Get('pdf')
  @RequirePermission('view_projects')
  async pdf(@Param('clientId') clientId: string, @Param('id') id: string, @Query('format') format: string | undefined, @Res() res: Response) {
    const doc = await this.reporting.printDocument(clientId, id);
    if (format === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(doc.html);
      return;
    }
    const pdf = await this.browser.printPdf(doc.html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${doc.fileName}"`);
    res.send(pdf);
  }

  /** MONTHLY only — locks the current content into a new revision for review. 409 on DAY1. */
  @Post('review')
  @Roles(Role.ADMIN)
  review(@Param('clientId') clientId: string, @Param('id') id: string) {
    return this.reporting.review(clientId, id);
  }

  /** MONTHLY only — `{approved:true}` releases, `{approved:false, changesRequested}` back to draft. 409 on DAY1. */
  @Post('approve')
  @Roles(Role.ADMIN)
  approve(@Param('clientId') clientId: string, @Param('id') id: string, @Body() dto: ApproveReportDto) {
    return this.reporting.approve(clientId, id, dto);
  }

  /** PATCH …/reports/:id — edit the title and/or executive summary as a new revision. Live reports update for the client at once. */
  @Patch()
  @Roles(Role.ADMIN)
  edit(@Param('clientId') clientId: string, @Param('id') id: string, @Body() dto: EditReportDto) {
    return this.reporting.edit(clientId, id, dto);
  }

  /** POST …/publish — release the newest revision to the client from any state but already-live. Skips the review gate. */
  @Post('publish')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  publish(@Param('clientId') clientId: string, @Param('id') id: string) {
    return this.reporting.publish(clientId, id);
  }

  /** Pulls a released report from client visibility. */
  @Post('withdraw')
  @Roles(Role.ADMIN)
  withdraw(@Param('clientId') clientId: string, @Param('id') id: string) {
    return this.reporting.withdraw(clientId, id);
  }

  @Post('share-links')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  createShareLink(@Param('clientId') clientId: string, @Param('id') id: string) {
    return this.reporting.createShareLink(clientId, id);
  }

  @Delete('share-links/:linkId')
  @Roles(Role.ADMIN)
  revokeShareLink(@Param('clientId') clientId: string, @Param('id') id: string, @Param('linkId') linkId: string) {
    return this.reporting.revokeShareLink(clientId, id, linkId);
  }
}

/**
 * Public, token-only render — no auth, no guards. HTML directly: no
 * reporting frontend consumes structured JSON yet, and the render
 * pipeline already produces a complete standalone page.
 */
@Controller('reports/public')
export class PublicReportController {
  constructor(private readonly reporting: ReportingService) {}

  @Get(':token')
  async getPublic(@Param('token') token: string, @Res() res: Response) {
    const { html } = await this.reporting.getPublic(token);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }
}

/** Client-portal read by slug, `view_projects` scoped — HTML directly, same reasoning as the public route. */
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, ClientScopeGuard)
export class ClientPortalReportController {
  constructor(private readonly reporting: ReportingService) {}

  @Get(':slug')
  @RequirePermission('view_projects')
  async getBySlug(@Param('slug') slug: string, @CurrentUser() user: AccessTokenPayload, @Res() res: Response) {
    const report = await this.reporting.getBySlug(user.clientId, slug).catch(() => null);
    if (!report) {
      res.status(404).send('Report not found.');
      return;
    }
    const html = await this.reporting.renderHtml(report.content);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }
}
