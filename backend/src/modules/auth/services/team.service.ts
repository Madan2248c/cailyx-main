import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ClientStatus, Role, UserStatus } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { AccessTokenPayload } from '../../../common/jwt/access-token-payload.js';
import type { CreateClientDto } from '../dto/create-client.dto.js';
import type { InviteTeamMemberDto } from '../dto/invite-team-member.dto.js';
import type { UpdateSeatLimitDto } from '../dto/update-seat-limit.dto.js';
import { TokenService } from './token.service.js';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../../email/email.service.js';
import { renderEmail } from '../../email/email-template.js';

/** Statuses that occupy a seat. A DISABLED or soft-deleted user frees theirs up. */
const SEAT_OCCUPYING_STATUSES: UserStatus[] = [UserStatus.INVITED, UserStatus.ACTIVE];
/** Code-level fallback — validation.schema.ts carries the same default. */
const DEFAULT_FRONTEND_URL = 'http://localhost:3000';

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  /** Lists all non-deleted clients with their active POC and seat usage, newest first. Admin-only (enforced by the controller's guard). */
  async listClients() {
    const clients = await this.prisma.client.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        users: {
          where: { role: Role.CLIENT_POC, deletedAt: null },
          select: { email: true, status: true },
        },
        _count: {
          select: {
            users: { where: { deletedAt: null, status: { in: SEAT_OCCUPYING_STATUSES } } },
          },
        },
      },
    });

    return clients.map((client) => ({
      id: client.id,
      name: client.name,
      status: client.status,
      seatLimit: client.seatLimit,
      seatsUsed: client._count.users,
      createdAt: client.createdAt,
      poc: client.users[0] ?? null,
    }));
  }

  /** Lists every non-deleted user in the caller's own client (including the caller), plus seat usage. */
  async listMembers(caller: AccessTokenPayload) {
    this.assertHasClientContext(caller);

    const client = await this.getClientOrThrow(caller.clientId!);
    const members = await this.prisma.user.findMany({
      where: { clientId: caller.clientId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    return {
      seatLimit: client.seatLimit,
      seatsUsed: members.filter((m) => SEAT_OCCUPYING_STATUSES.includes(m.status)).length,
      members: members.map((member) => this.publicUser(member)),
    };
  }

  /** Creates a new client and its POC (INVITED status), then issues the POC's initial invite — unless deferred for the Day-1 pipeline. */
  async createClientWithPoc(dto: CreateClientDto, adminId: string) {
    const email = this.normalizeEmail(dto.pocEmail);

    const client = await this.prisma.client.create({
      data: { name: dto.name, createdBy: adminId, seatLimit: dto.seatLimit },
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

    if (dto.deferInvite) {
      // Silent creation: the Day-1 pipeline's final step sends the first
      // invite with "your audit is ready" context. Logged so a deferred
      // POC is visible (and resendable) before the pipeline finishes.
      this.logger.log(`Invite deferred for POC ${poc.id} (client ${client.id}). The Day-1 pipeline will send it.`);
    } else {
      await this.issueInvite(poc.id, adminId, email);
    }

    return { client, poc: this.publicUser(poc) };
  }

  /** Updates a client's seat limit. Admin-only; doesn't retroactively touch existing users even if now over the new limit. */
  async updateSeatLimit(clientId: string, dto: UpdateSeatLimitDto) {
    await this.getClientOrThrow(clientId);

    await this.prisma.client.update({
      where: { id: clientId },
      data: { seatLimit: dto.seatLimit },
    });

    return { success: true };
  }

  /** Invites a CLIENT_MEMBER into the caller's own client. Requires the caller to have a client context (i.e. not an ADMIN), and a free seat. */
  async inviteTeamMember(dto: InviteTeamMemberDto, caller: AccessTokenPayload) {
    this.assertHasClientContext(caller);

    const client = await this.getClientOrThrow(caller.clientId!);
    const seatsUsed = await this.prisma.user.count({
      where: {
        clientId: caller.clientId,
        deletedAt: null,
        status: { in: SEAT_OCCUPYING_STATUSES },
      },
    });

    if (seatsUsed >= client.seatLimit) {
      throw new BadRequestException(
        `Seat limit reached (${client.seatLimit}). Free up a seat or ask an admin to increase it.`,
      );
    }

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

    await this.issueInvite(member.id, caller.sub, email);

    return this.publicUser(member);
  }

  /** Invalidates any unconsumed invite for the target and issues a fresh one. Target must still be INVITED, and in the caller's own client unless the caller is ADMIN. */
  async resendInvite(targetUserId: string, caller: AccessTokenPayload) {
    const target = await this.getScopedUser(targetUserId, caller);

    if (target.status !== UserStatus.INVITED) {
      throw new BadRequestException('This user has already completed onboarding.');
    }

    await this.issueInvite(target.id, caller.sub, target.email);
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

  /**
   * Issues (or re-issues) an invite token, then delivers it by email. When
   * email is unconfigured the token is debug-logged (dev path, keeps the
   * flow testable without infrastructure). A failed send throws 503 — the
   * caller sees the failure instead of a silent loss; the invite itself is
   * persisted, so a resend can retry delivery.
   */
  private async issueInvite(userId: string, createdBy: string, email: string): Promise<void> {
    const raw = await this.persistInviteToken(userId, createdBy);

    if (!this.emailService.isConfigured()) {
      // Dev path: no email infrastructure — keep the flow testable end-to-end.
      this.logger.debug(`Invite token for user ${userId}: ${raw}`);
      return;
    }

    const frontendUrl = this.config.get<string>('FRONTEND_URL', DEFAULT_FRONTEND_URL);
    const ttlHours = this.config.getOrThrow<number>('auth.inviteTokenTtlHours');
    const link = `${frontendUrl}/accept-invite?token=${raw}`;
    try {
      await this.emailService.send({
        to: email,
        subject: "You've been invited to Cailyx",
        html: renderEmail({
          heading: "You've been invited to Cailyx",
          paragraphs: ["You've been invited to join Cailyx, your Rothenhall client portal for AI visibility and site health."],
          cta: { label: 'Set up your account', url: link },
          footnote: `This link expires in ${ttlHours} ${ttlHours === 1 ? 'hour' : 'hours'}. If you weren't expecting this, you can safely ignore it.`,
        }),
      });
    } catch (err) {
      this.logger.error(`Invite email to ${email} failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException(`email-send-failed: ${(err as Error).message}`);
    }
  }

  /**
   * Day-1 pipeline's final step: delivers the "your audit is ready" email to
   * the client's POC. Still-INVITED → a fresh invite carrying the ready
   * context (this is the deferred first invite); already-ACTIVE → a plain
   * ready email with a login link. No POC, or email unconfigured → honest
   * `{ sent: false }`, never a throw for missing infrastructure (the caller
   * records it); a failed send throws 503 like any other invite send.
   */
  async sendDay1ReadyEmail(clientId: string): Promise<{ sent: true; kind: 'invite' | 'ready' } | { sent: false; reason: string }> {
    const poc = await this.getPocContact(clientId);
    if (!poc) {
      this.logger.warn(`Day-1 ready email skipped for client ${clientId}: no POC on file.`);
      return { sent: false, reason: 'no-poc' };
    }
    if (!this.emailService.isConfigured()) {
      this.logger.debug(`Day-1 ready email for ${poc.email} not sent: email unconfigured.`);
      return { sent: false, reason: 'email-unconfigured' };
    }

    const frontendUrl = this.config.get<string>('FRONTEND_URL', DEFAULT_FRONTEND_URL);
    if (poc.status === UserStatus.ACTIVE) {
      try {
        await this.emailService.send({
          to: poc.email,
          subject: 'Your Day-1 audit is ready',
          html: renderEmail({
            heading: 'Your Day-1 audit is ready',
            paragraphs: ['Your Day-1 audit is ready to view in Cailyx.'],
            cta: { label: 'Log in to Cailyx', url: `${frontendUrl}/login` },
          }),
        });
      } catch (err) {
        this.logger.error(`Day-1 ready email to ${poc.email} failed: ${(err as Error).message}`);
        throw new ServiceUnavailableException(`email-send-failed: ${(err as Error).message}`);
      }
      return { sent: true, kind: 'ready' };
    }

    const raw = await this.persistInviteToken(poc.id, null);
    const ttlHours = this.config.getOrThrow<number>('auth.inviteTokenTtlHours');
    const link = `${frontendUrl}/accept-invite?token=${raw}`;
    try {
      await this.emailService.send({
        to: poc.email,
        subject: 'Your Day-1 audit is ready: set up your account',
        html: renderEmail({
          heading: 'Your Day-1 audit is ready',
          paragraphs: ['Your Day-1 audit is ready. Set up your account to view it.'],
          cta: { label: 'Set up your account', url: link },
          footnote: `This link expires in ${ttlHours} ${ttlHours === 1 ? 'hour' : 'hours'}. If you weren't expecting this, you can safely ignore it.`,
        }),
      });
    } catch (err) {
      this.logger.error(`Day-1 ready email to ${poc.email} failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException(`email-send-failed: ${(err as Error).message}`);
    }
    return { sent: true, kind: 'invite' };
  }

  /** The client's POC contact (read-only) — what the Day-1 notify step addresses. */
  async getPocContact(clientId: string): Promise<{ id: string; email: string; status: UserStatus } | null> {
    const poc = await this.prisma.user.findFirst({
      where: { clientId, role: Role.CLIENT_POC, deletedAt: null },
      select: { id: true, email: true, status: true },
    });
    return poc;
  }

  /**
   * Invalidates earlier unconsumed invites and persists a fresh token,
   * returning the raw value for the email link. The raw value is never
   * stored — only its hash.
   */
  private async persistInviteToken(userId: string, createdBy: string | null): Promise<string> {
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
    return token.raw;
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
