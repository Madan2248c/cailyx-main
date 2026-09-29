import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

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

/** The client's "we've applied this": an optional note and a link to the change. */
export class ClientAppliedDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  prUrl?: string;
}

export class DraftSharedDto {
  @IsBoolean()
  shared!: boolean;
}

/** A fix an admin adds by hand. Everything the automatic checks would have filled in is chosen here. */
export class CreateManualFixDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  /** The page URL the fix is about, or the site origin for a site-wide fix. */
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  target!: string;

  @IsIn(['CODE', 'CONFIG', 'CONTENT', 'OFF_SITE', 'INVESTIGATE'])
  fixClass!: 'CODE' | 'CONFIG' | 'CONTENT' | 'OFF_SITE' | 'INVESTIGATE';

  @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  severity!: 'LOW' | 'MEDIUM' | 'HIGH';

  @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  effort!: 'LOW' | 'MEDIUM' | 'HIGH';

  /** Numbered steps, in order. */
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  steps!: string[];

  /** Why it matters, shown as the evidence. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  /** Batches related fixes. Defaults to "manual". */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  groupKey?: string;

  /** Ask the client to approve before work starts. */
  @IsOptional()
  @IsBoolean()
  needsClientDecision?: boolean;
}
