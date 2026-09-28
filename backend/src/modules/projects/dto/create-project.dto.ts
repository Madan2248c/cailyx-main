import { Equals, IsNumber, IsOptional, IsPositive, IsString, Matches, MinLength } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @MinLength(1)
  name!: string;

  /**
   * Loosely validated here — normalization + the real "is this a usable
   * domain" check happens in ProjectsService (see docs/analysis/projects.md).
   * This just rejects obvious garbage (whitespace, no dot, an `@`) before it
   * reaches the service.
   */
  @IsString()
  @MinLength(1)
  @Matches(/^[^\s@]+\.[^\s@]+$/, { message: 'domain must look like a hostname (e.g. acme.com)' })
  domain!: string;

  /**
   * Spend pre-authorization for the automatic Day-1 run (see
   * docs/analysis/day1-pipeline.md). Creating a project starts the pipeline
   * — there is no mid-pipeline spend click — so consent must be explicit.
   */
  @Equals(true, { message: 'day1SpendConsent must be true. Creating a project authorizes its automatic Day-1 run.' })
  day1SpendConsent!: boolean;

  /** Optional Day-1 spend ceiling in USD. Omitted = uncapped at this layer (per-module caps still apply). */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  day1SpendCeilingUsd?: number;
}
