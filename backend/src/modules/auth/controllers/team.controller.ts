import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import type { AccessTokenPayload } from '../../../common/jwt/access-token-payload.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../../common/guards/permissions.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { Role } from '../../../generated/prisma/enums.js';
import { CreateClientDto } from '../dto/create-client.dto.js';
import { InviteTeamMemberDto } from '../dto/invite-team-member.dto.js';
import { TeamService } from '../services/team.service.js';

/**
 * Client/team management: admin onboards clients, POCs manage their own
 * team. `@Roles` gates platform-level actions no permission grant should
 * ever hand to a client role; `@RequirePermission` gates everything else,
 * so future roles inherit access purely by being granted the permission.
 */
@Controller('team')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  /** GET /team/clients — list every client. Admin-only. */
  @Get('clients')
  @Roles(Role.ADMIN)
  listClients() {
    return this.teamService.listClients();
  }

  /** GET /team/members — list the caller's own client's team. */
  @Get('members')
  @RequirePermission('manage_team')
  listMembers(@CurrentUser() user: AccessTokenPayload) {
    return this.teamService.listMembers(user);
  }

  /** POST /team/clients — create a client and invite its POC. Admin-only. */
  @Post('clients')
  @Roles(Role.ADMIN)
  createClient(@Body() dto: CreateClientDto, @CurrentUser() user: AccessTokenPayload) {
    return this.teamService.createClientWithPoc(dto, user.sub);
  }

  /** PATCH /team/clients/:id/suspend — cut off a client's access. Admin-only. */
  @Patch('clients/:id/suspend')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  suspendClient(@Param('id') id: string) {
    return this.teamService.suspendClient(id);
  }

  /** PATCH /team/clients/:id/activate — restore a suspended client. Admin-only. */
  @Patch('clients/:id/activate')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  activateClient(@Param('id') id: string) {
    return this.teamService.activateClient(id);
  }

  /** POST /team/invite — invite a team member into the caller's own client. */
  @Post('invite')
  @RequirePermission('manage_team')
  invite(@Body() dto: InviteTeamMemberDto, @CurrentUser() user: AccessTokenPayload) {
    return this.teamService.inviteTeamMember(dto, user);
  }

  /** POST /team/users/:id/resend-invite — reissue an invite for a still-INVITED user. */
  @Post('users/:id/resend-invite')
  @RequirePermission('manage_team')
  @HttpCode(HttpStatus.OK)
  resendInvite(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.teamService.resendInvite(id, user);
  }

  /** PATCH /team/users/:id/disable — disable a user and revoke their sessions. */
  @Patch('users/:id/disable')
  @RequirePermission('manage_team')
  @HttpCode(HttpStatus.OK)
  disableUser(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.teamService.disableUser(id, user);
  }

  /** PATCH /team/users/:id/enable — re-activate a disabled user. */
  @Patch('users/:id/enable')
  @RequirePermission('manage_team')
  @HttpCode(HttpStatus.OK)
  enableUser(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.teamService.enableUser(id, user);
  }
}
