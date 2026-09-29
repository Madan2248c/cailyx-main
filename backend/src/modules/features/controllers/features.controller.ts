import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { ClientScopeGuard } from '../../../common/guards/client-scope.guard.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import type { AccessTokenPayload } from '../../../common/jwt/access-token-payload.js';
import { Role } from '../../../generated/prisma/enums.js';
import { SetFeatureDto } from '../dto/features.dto.js';
import { FeaturesService } from '../services/features.service.js';

@Controller('team/clients/:clientId/features')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, ClientScopeGuard)
export class FeaturesController {
  constructor(private readonly features: FeaturesService) {}

  /** GET …/features: every feature and whether it is on for this client. The portal reads this to build its menu. */
  @Get()
  @RequirePermission('view_projects')
  get(@Param('clientId') clientId: string) {
    return this.features.getFlags(clientId);
  }

  /** PUT …/features/:key: switch one feature on or off. Admin-only. */
  @Put(':key')
  @Roles(Role.ADMIN)
  set(@Param('clientId') clientId: string, @Param('key') key: string, @Body() dto: SetFeatureDto, @CurrentUser() user: AccessTokenPayload) {
    return this.features.setFlag(clientId, key, dto.enabled, user.sub);
  }
}
