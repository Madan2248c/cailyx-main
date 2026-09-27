import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
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
}
