import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClientStatus, Role, UserStatus } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { AccessTokenPayload } from '../../../common/jwt/access-token-payload.js';
import type { CreateClientDto } from '../dto/create-client.dto.js';
import type { InviteTeamMemberDto } from '../dto/invite-team-member.dto.js';
import { TokenService } from './token.service.js';

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
  ) {}

  /** Lists all non-deleted clients with their active POC's email/status, newest first. Admin-only (enforced by the controller's guard). */
  async listClients() {
    const clients = await this.prisma.client.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        users: {
          where: { role: Role.CLIENT_POC, deletedAt: null },
          select: { email: true, status: true },
        },
      },
    });

    return clients.map((client) => ({
      id: client.id,
      name: client.name,
      status: client.status,
      createdAt: client.createdAt,
      poc: client.users[0] ?? null,
    }));
  }

  /** Lists every non-deleted user in the caller's own client, including the caller. */
  async listMembers(caller: AccessTokenPayload) {
    this.assertHasClientContext(caller);

    const members = await this.prisma.user.findMany({
      where: { clientId: caller.clientId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    return members.map((member) => this.publicUser(member));
  }

  /** Creates a new client and its POC (INVITED status), then issues the POC's initial invite. */
  async createClientWithPoc(dto: CreateClientDto, adminId: string) {
    const email = this.normalizeEmail(dto.pocEmail);

    const client = await this.prisma.client.create({
      data: { name: dto.name, createdBy: adminId },
    });

    const poc = await this.prisma.user.create({
      data: {
        email,
        role: Role.CLIENT_POC,
        clientId: client.id,
        status: UserStatus.INVITED,
        invitedBy: adminId,
      },
    });

    await this.issueInvite(poc.id, adminId);

    return { client, poc: this.publicUser(poc) };
  }

  /** Invites a CLIENT_MEMBER into the caller's own client. Requires the caller to have a client context (i.e. not an ADMIN). */
  async inviteTeamMember(dto: InviteTeamMemberDto, caller: AccessTokenPayload) {
    this.assertHasClientContext(caller);
    const email = this.normalizeEmail(dto.email);

    const member = await this.prisma.user.create({
      data: {
        email,
        role: Role.CLIENT_MEMBER,
        clientId: caller.clientId,
        status: UserStatus.INVITED,
        invitedBy: caller.sub,
      },
    });

    await this.issueInvite(member.id, caller.sub);

    return this.publicUser(member);
  }

  /** Invalidates any unconsumed invite for the target and issues a fresh one. Target must still be INVITED, and in the caller's own client unless the caller is ADMIN. */
  async resendInvite(targetUserId: string, caller: AccessTokenPayload) {
    const target = await this.getScopedUser(targetUserId, caller);

    if (target.status !== UserStatus.INVITED) {
      throw new BadRequestException('This user has already completed onboarding.');
    }

    await this.issueInvite(target.id, caller.sub);
    return { success: true };
  }

  /** Disables a user and revokes all of their active sessions. Can't be used on the caller's own account. */
  async disableUser(targetUserId: string, caller: AccessTokenPayload) {
    const target = await this.getScopedUser(targetUserId, caller);
    this.assertNotSelf(target.id, caller);

    await this.prisma.user.update({
      where: { id: target.id },
      data: { status: UserStatus.DISABLED },
    });

    await this.prisma.refreshToken.updateMany({
      where: { userId: target.id, revokedAt: null, deletedAt: null },
      data: { revokedAt: new Date() },
    });

    return { success: true };
  }

  /** Re-activates a DISABLED user and resets their lockout state. */
  async enableUser(targetUserId: string, caller: AccessTokenPayload) {
    const target = await this.getScopedUser(targetUserId, caller);

    if (target.status !== UserStatus.DISABLED) {
      throw new BadRequestException('This user is not disabled.');
    }

    await this.prisma.user.update({
      where: { id: target.id },
      data: { status: UserStatus.ACTIVE, failedAttempts: 0, lockedUntil: null },
    });

    return { success: true };
  }

  /** Suspends a client and immediately revokes every active session for its users. Admin-only. */
  async suspendClient(clientId: string) {
    const client = await this.getClientOrThrow(clientId);

    await this.prisma.client.update({
      where: { id: client.id },
      data: { status: ClientStatus.SUSPENDED },
    });

    await this.prisma.refreshToken.updateMany({
      where: { user: { clientId: client.id }, revokedAt: null, deletedAt: null },
      data: { revokedAt: new Date() },
    });

    return { success: true };
  }

  /** Reactivates a suspended client. Admin-only. */
  async activateClient(clientId: string) {
    const client = await this.getClientOrThrow(clientId);

    await this.prisma.client.update({
      where: { id: client.id },
      data: { status: ClientStatus.ACTIVE },
    });

    return { success: true };
  }

  private async issueInvite(userId: string, createdBy: string): Promise<void> {
    // A resend must invalidate any earlier unconsumed invite for this user.
    await this.prisma.authToken.updateMany({
      where: { userId, type: 'INITIAL_INVITE', consumedAt: null, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    await this.prisma.authToken.updateMany({
      where: { userId, type: 'RESEND_INVITE', consumedAt: null, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    const token = this.tokenService.generateOpaqueToken();
    await this.prisma.authToken.create({
      data: {
        userId,
        tokenHash: token.hash,
        type: 'INITIAL_INVITE',
        expiresAt: this.tokenService.inviteTokenExpiry(),
        createdBy,
      },
    });

    // TODO: send this via the email module once it exists. Logged for now
    // so the invite flow is testable end-to-end without email infrastructure.
    this.logger.debug(`Invite token for user ${userId}: ${token.raw}`);
  }

  private async getScopedUser(targetUserId: string, caller: AccessTokenPayload) {
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, deletedAt: null },
    });

    if (!target) {
      throw new NotFoundException('User not found.');
    }

    if (caller.role !== Role.ADMIN) {
      this.assertHasClientContext(caller);
      if (target.clientId !== caller.clientId) {
        throw new ForbiddenException('You do not have access to this user.');
      }
    }

    return target;
  }

  private async getClientOrThrow(clientId: string) {
    const client = await this.prisma.client.findFirst({ where: { id: clientId, deletedAt: null } });
    if (!client) {
      throw new NotFoundException('Client not found.');
    }
    return client;
  }

  private assertHasClientContext(caller: AccessTokenPayload): void {
    if (!caller.clientId) {
      throw new BadRequestException('This action requires a client context.');
    }
  }

  private assertNotSelf(targetId: string, caller: AccessTokenPayload): void {
    if (targetId === caller.sub) {
      throw new BadRequestException('You cannot perform this action on your own account.');
    }
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private publicUser(user: { id: string; email: string; role: Role; clientId: string | null; status: UserStatus }) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      clientId: user.clientId,
      status: user.status,
    };
  }
}
