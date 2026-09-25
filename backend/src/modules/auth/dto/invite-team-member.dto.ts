import { IsEmail } from 'class-validator';

export class InviteTeamMemberDto {
  @IsEmail()
  email!: string;
}
