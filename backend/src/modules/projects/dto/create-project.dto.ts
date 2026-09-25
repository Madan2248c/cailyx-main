import { IsString, Matches, MinLength } from 'class-validator';

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
}
