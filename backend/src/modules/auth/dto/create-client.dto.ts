import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateClientDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  pocEmail!: string;

  /** Total seats (POC + members) for this client. Defaults to 1 if omitted. */
  @IsOptional()
  @IsInt()
  @Min(1)
  seatLimit?: number;

  /**
   * Defers the POC invite until the Day-1 pipeline completes (which sends
   * the first invite with "your audit is ready" context). Default false =
   * the invite is emailed immediately, as before.
   */
  @IsOptional()
  @IsBoolean()
  deferInvite?: boolean;
}
