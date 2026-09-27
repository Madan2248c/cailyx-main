import { IsObject, IsString, MinLength } from 'class-validator';

export class UpdateCompanyContextDto {
  /**
   * Field updates keyed by `section.field` (e.g. `identity.business_name`).
   * Scalar fields take a string (empty string clears) or null; array fields
   * take a string[]. Unknown paths and kind mismatches are 400s — see
   * `DiscoveryService.updateProfileFields`.
   */
  @IsObject()
  fields!: Record<string, unknown>;
}

export class UpdateSocialProfileDto {
  @IsString()
  @MinLength(1)
  url!: string;
}
