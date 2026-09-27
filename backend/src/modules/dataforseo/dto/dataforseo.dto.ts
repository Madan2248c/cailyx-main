import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class CollectDataforseoDto {
  /**
   * Datasets to collect. Defaults to the schedule's (or module defaults)
   * when omitted. Unknown names 400 — never silently dropped from a
   * (future-live) paid pull.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  datasets?: string[];
}

export class SetDataforseoScheduleDto {
  /** WEEKLY, MONTHLY, or MANUAL_ONLY (removes the recurrence). */
  @IsIn(['WEEKLY', 'MONTHLY', 'MANUAL_ONLY'])
  cadence!: 'WEEKLY' | 'MONTHLY' | 'MANUAL_ONLY';

  /** Datasets the schedule collects. Defaults to the module defaults. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  datasets?: string[];

  /** The scheduler fires nothing unless this is true — spend never automatic. */
  @IsOptional()
  @IsBoolean()
  spendOptIn?: boolean;
}
