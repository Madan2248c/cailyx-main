import type { Role } from '../../generated/prisma/enums.js';

/** Claims carried by the short-lived access token. Verified locally on every request — no DB hit. */
export interface AccessTokenPayload {
  sub: string;
  role: Role;
  clientId: string | null;
}
