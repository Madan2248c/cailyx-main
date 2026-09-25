import type { Role, UserStatus } from './auth';

export type ClientStatus = 'ACTIVE' | 'SUSPENDED';

export interface ClientSummary {
  id: string;
  name: string;
  status: ClientStatus;
  createdAt: string;
  poc: { email: string; status: UserStatus } | null;
}

export interface TeamMember {
  id: string;
  email: string;
  role: Role;
  clientId: string | null;
  status: UserStatus;
}
