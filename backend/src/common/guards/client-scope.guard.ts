import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '../../generated/prisma/enums.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';

/**
 * Client scoping for every `team/clients/:clientId/...` route: a non-admin
 * may only act on their own client. `PermissionsGuard` answers "may this
 * role do this at all?"; this guard answers "is this *their* client?".
 * Without it, a signed-in client user who learned another client's id could
 * read that client's data through any module endpoint that trusts the URL.
 *
 * 404 rather than 403, so the response doesn't confirm that another client
 * exists. Runs after `JwtAuthGuard` (needs `request.user`). Routes without a
 * `:clientId` param pass through untouched.
 */
@Injectable()
export class ClientScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & { params?: Record<string, string> }>();
    const clientId = request.params?.clientId;
    if (!clientId) return true;

    const { user } = request;
    if (user.role === Role.ADMIN) return true;
    if (user.clientId && user.clientId === clientId) return true;

    throw new NotFoundException('Not found.');
  }
}
