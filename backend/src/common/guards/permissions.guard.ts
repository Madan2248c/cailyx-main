import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';

/**
 * Checks the caller's role against the role_permissions table — this is
 * the flexible part of the login module's authorization model (see
 * docs/analysis/auth.md): a role's grants can change without a deploy.
 * ADMIN bypasses this entirely, by design, rather than needing rows seeded
 * for every permission.
 *
 * Must run after JwtAuthGuard — reads request.user, which JwtAuthGuard sets.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<string>(PERMISSION_KEY, context.getHandler());
    if (!required) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (user.role === Role.ADMIN) {
      return true;
    }

    const grant = await this.prisma.rolePermission.findFirst({
      where: { role: user.role, deletedAt: null, permission: { key: required } },
    });

    if (!grant) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    return true;
  }
}
