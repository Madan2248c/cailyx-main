export type Role = 'ADMIN' | 'CLIENT_POC' | 'CLIENT_MEMBER';
export type UserStatus = 'INVITED' | 'ACTIVE' | 'DISABLED';

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  clientId: string | null;
  status: UserStatus;
}

export interface AuthResponse {
  accessToken: string;
  user: SessionUser;
}
