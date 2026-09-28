import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { ClientScopeGuard } from '../../../common/guards/client-scope.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { Role } from '../../../generated/prisma/enums.js';
import { AddPromptDto, CreateQuerySetDto, GenerateQuerySetDto } from '../dto/query-set.dto.js';
import { QuerySetService } from '../services/query-set.service.js';

/**
 * Staff-facing query-set management, nested under a project the same way
 * Technical Audit and Social Activity are — plus a few routes keyed by set
 * id alone (add/remove/activate/fork), since a set id is globally unique.
 */
@Controller('team/clients/:clientId/projects/:projectId/query-sets')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, ClientScopeGuard)
export class QuerySetController {
  constructor(private readonly querySets: QuerySetService) {}

  /** POST — manual create (v1, draft). Admin-only. */
  @Post()
  @Roles(Role.ADMIN)
  create(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Body() dto: CreateQuerySetDto) {
    return this.querySets.create(clientId, projectId, dto.label);
  }

  /** POST …/generate — two-step LLM generation. Admin-only. 409 without a CompanyContextProfile. */
  @Post('generate')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  generate(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Body() dto: GenerateQuerySetDto) {
    return this.querySets.generate(clientId, projectId, { tier: dto.tier });
  }

  /** GET — this project's query sets, newest version first. `?status=` filters. */
  @Get()
  @RequirePermission('view_projects')
  list(@Param('clientId') clientId: string, @Param('projectId') projectId: string, @Query('status') status?: string) {
    return this.querySets.list(clientId, projectId, status);
  }

  /** GET …/export — the active set, full export. */
  @Get('export')
  @RequirePermission('view_projects')
  export(@Param('clientId') clientId: string, @Param('projectId') projectId: string) {
    return this.querySets.export(clientId, projectId);
  }
}

/** Query-set-id-scoped routes: read one, add/remove a manual prompt, activate, fork. */
@Controller('team/clients/:clientId/query-sets/:id')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, ClientScopeGuard)
export class QuerySetItemController {
  constructor(private readonly querySets: QuerySetService) {}

  /** GET — one set + its buckets + items. */
  @Get()
  @RequirePermission('view_projects')
  getOne(@Param('clientId') clientId: string, @Param('id') id: string) {
    return this.querySets.getOne(clientId, id);
  }

  /** POST …/prompts — add a manual prompt to a draft. 400 if not draft. */
  @Post('prompts')
  @Roles(Role.ADMIN)
  addPrompt(@Param('clientId') clientId: string, @Param('id') id: string, @Body() dto: AddPromptDto) {
    return this.querySets.addPrompt(clientId, id, dto);
  }

  /** DELETE …/prompts/:itemId — remove a prompt from a draft. 400 if not draft. */
  @Delete('prompts/:itemId')
  @Roles(Role.ADMIN)
  removePrompt(@Param('clientId') clientId: string, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.querySets.removePrompt(clientId, id, itemId);
  }

  /** POST …/activate — lock the set. 400 if not draft. */
  @Post('activate')
  @Roles(Role.ADMIN)
  activate(@Param('clientId') clientId: string, @Param('id') id: string) {
    return this.querySets.activate(clientId, id);
  }

  /** POST …/fork — new draft version, copying buckets + items. */
  @Post('fork')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  fork(@Param('clientId') clientId: string, @Param('id') id: string) {
    return this.querySets.fork(clientId, id);
  }
}
