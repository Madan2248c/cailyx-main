import { Equals, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class TriggerSocialActivityRunDto {
  /**
   * Explicit spend approval — required `true`. Without it the trigger 400s
   * and nothing was run, nothing was spent.
   */
  @IsBoolean()
  @Equals(true)
  confirmSpend!: true;

  /** Platforms to pull. Defaults to the module default set. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  platforms?: string[];

  /** Recent posts per platform. Defaults to `APIFY_POSTS_PER_PLATFORM`. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  postsPerPlatform?: number;

  /** Aggregation window in days. Defaults to `SOCIAL_WINDOW_DAYS`. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  windowDays?: number;

  /** Admit PROBABLE discovery rows as pull targets. Default false. */
  @IsOptional()
  @IsBoolean()
  includeProbable?: boolean;
}

export class SetSocialActivityScheduleDto {
  /** WEEKLY, MONTHLY, or MANUAL_ONLY (removes the recurrence). */
  @IsIn(['WEEKLY', 'MONTHLY', 'MANUAL_ONLY'])
  cadence!: 'WEEKLY' | 'MONTHLY' | 'MANUAL_ONLY';

  /** The scheduler fires nothing unless this is true — spend never automatic. */
  @IsOptional()
  @IsBoolean()
  spendOptIn?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  platforms?: string[];

  @IsOptional()
  @IsNumber()
  @IsPositive()
  windowDays?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  postsPerPlatform?: number;
}
