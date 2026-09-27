import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { GoogleProvider } from '../google.types.js';

export class ConnectQueryDto {
  @IsIn(['gsc', 'ga'])
  provider!: GoogleProvider;
}

export class DaysQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;

  /** Explicit Search Console site (testing fallback when auto-match finds nothing). */
  @IsOptional()
  @IsString()
  siteUrl?: string;

  /** Explicit Analytics property (same fallback). */
  @IsOptional()
  @IsString()
  propertyId?: string;
}
