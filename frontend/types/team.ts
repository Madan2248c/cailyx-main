import type { Role, UserStatus } from './auth';

export type ClientStatus = 'ACTIVE' | 'SUSPENDED';

export interface ClientSummary {
  id: string;
  name: string;
  status: ClientStatus;
  seatLimit: number;
  seatsUsed: number;
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

export interface TeamMembers {
  seatLimit: number;
  seatsUsed: number;
  members: TeamMember[];
}
