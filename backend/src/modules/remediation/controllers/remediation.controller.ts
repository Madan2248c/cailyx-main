import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import type { AccessTokenPayload } from '../../../common/jwt/access-token-payload.js';
import { FixClass, FixStatus, Role } from '../../../generated/prisma/enums.js';
import { FixDecisionDto, SetFixStatusDto } from '../dto/remediation.dto.js';
import { RemediationDraftService } from '../services/remediation-draft.service.js';
import { RemediationSyncService } from '../services/remediation-sync.service.js';
import { RemediationService, type FixListFilter } from '../services/remediation.service.js';

const STATUSES = new Set<string>(Object.values(FixStatus));
const CLASSES = new Set<string>(Object.values(FixClass));
const SEVERITIES = new Set(['LOW', 'MEDIUM', 'HIGH']);

/**
 * Staff-facing Fix Plan for one project, nested like every other module.
 * `sync` is admin-only; reads need `view_projects`.
 */
@Controller('team/clients/:clientId/projects/:projectId/remediation')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class RemediationController {
  constructor(
    private readonly remediation: RemediationService,
    private readonly syncer: RemediationSyncService,
  ) {}

  /** POST …/sync — turn the latest audit findings into fix specs. Deterministic, no LLM, no paid call. 409 when no audit has completed. */
  @Post('sync')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  sync(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @CurrentUser() user: AccessTokenPayload) {
    return this.syncer.sync(clientId, projectId, user.sub);
  }

  @Get('runs')
  @RequirePermission('view_projects')
  listRuns(@Param('clientId') clientId: string, @Param('projectId') projectId: string) {
    return this.remediation.listRuns(clientId, projectId);
  }

  /** GET …/fixes?status=OPEN,REGRESSED&fixClass=CODE&groupKey=robots&severity=HIGH */
  @Get('fixes')
  @RequirePermission('view_projects')
  listFixes(
    @Param('clientId') clientId: string,
    @Param('projectId') projectId: string,
    @Query('status') status?: string,
    @Query('fixClass') fixClass?: string,
    @Query('groupKey') groupKey?: string,
    @Query('severity') severity?: string,
  ) {
    return this.remediation.listFixes(clientId, projectId, parseFilter(status, fixClass, groupKey, severity));
  }

  @Get('summary')
  @RequirePermission('view_projects')
  summary(@Param('clientId') clientId: string, @Param('projectId') projectId: string) {
    return this.remediation.summary(clientId, projectId);
  }

  /** GET …/export?format=md|json — the fix pack for a developer, agency or agent. */
  @Get('export')
  @RequirePermission('view_projects')
  async export(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Query('format') format: string | undefined, @Res() res: Response) {
    const fmt = format === 'json' ? 'json' : 'md';
    const pack = await this.remediation.exportFixPack(clientId, projectId, fmt);
    if (fmt === 'json') {
      res.json(pack);
      return;
    }
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="fix-plan-${projectId}.md"`);
    res.send(pack);
  }
}

/** Run-id-scoped read. */
@Controller('team/clients/:clientId/remediation/runs/:id')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class RemediationRunController {
  constructor(private readonly remediation: RemediationService) {}

  @Get()
  @RequirePermission('view_projects')
  getRun(@Param('clientId') clientId: string, @Param('id') id: string) {
    return this.remediation.getRun(clientId, id);
  }
}

/** Fix-id-scoped: read one fix with its history, and every action on it. Actions are admin-only. */
@Controller('team/clients/:clientId/remediation/fixes/:id')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class RemediationFixController {
  constructor(
    private readonly remediation: RemediationService,
    private readonly drafts: RemediationDraftService,
  ) {}

  @Get()
  @RequirePermission('view_projects')
  getFix(@Param('clientId') clientId: string, @Param('id') id: string) {
    return this.remediation.getFix(clientId, id);
  }

  /** PATCH …/status — OPEN / IN_PROGRESS / APPLIED / DISMISSED (reason required). VERIFIED only via /verify. */
  @Patch('status')
  @Roles(Role.ADMIN)
  setStatus(@Param('clientId') clientId: string, @Param('id') id: string, @Body() dto: SetFixStatusDto, @CurrentUser() user: AccessTokenPayload) {
    return this.remediation.setStatus(clientId, id, dto, user.sub);
  }

  /** POST …/decision — record the client's approve/decline on a fix that needs it. */
  @Post('decision')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  decide(@Param('clientId') clientId: string, @Param('id') id: string, @Body() dto: FixDecisionDto, @CurrentUser() user: AccessTokenPayload) {
    return this.remediation.decide(clientId, id, dto.decision, dto.note, user.sub);
  }

  /** POST …/verify — re-check the live site now. 409 for fixes only a newer audit can confirm. */
  @Post('verify')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  verify(@Param('clientId') clientId: string, @Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.remediation.verify(clientId, id, user.sub);
  }

  /** POST …/draft — one LLM copy draft (title, meta, or answer-page brief). Spend-capped per project. */
  @Post('draft')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  draft(@Param('clientId') clientId: string, @Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.drafts.draft(clientId, id, user.sub);
  }
}

export function parseFilter(status?: string, fixClass?: string, groupKey?: string, severity?: string): FixListFilter {
  const filter: FixListFilter = {};
  if (status) {
    const list = status.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    const bad = list.filter((s) => !STATUSES.has(s));
    if (bad.length) throw new BadRequestException(`Unknown status: ${bad.join(', ')}.`);
    filter.status = list as FixStatus[];
  }
  if (fixClass) {
    const c = fixClass.toUpperCase();
    if (!CLASSES.has(c)) throw new BadRequestException(`Unknown fixClass: ${fixClass}.`);
    filter.fixClass = c as FixClass;
  }
  if (severity) {
    const s = severity.toUpperCase();
    if (!SEVERITIES.has(s)) throw new BadRequestException(`Unknown severity: ${severity}.`);
    filter.severity = s as FixListFilter['severity'];
  }
  if (groupKey) filter.groupKey = groupKey;
  return filter;
}
