import { IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

/** Every status a person may request — VERIFIED is rejected by the service with a pointer to /verify. */
const REQUESTABLE = ['OPEN', 'IN_PROGRESS', 'APPLIED', 'DISMISSED', 'VERIFIED'] as const;

export class SetFixStatusDto {
  @IsIn(REQUESTABLE)
  status!: (typeof REQUESTABLE)[number];

  /** Required when dismissing. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  /** The PR / change that applied the fix, when there is one. */
  @IsOptional()
  @IsUrl({ require_protocol: true })
  prUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class FixDecisionDto {
  @IsIn(['APPROVED', 'DECLINED'])
  decision!: 'APPROVED' | 'DECLINED';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
