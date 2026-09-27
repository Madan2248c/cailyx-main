import { IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { SURFACES } from '../measurement.types.js';

export class CreateMeasurementRunDto {
  @IsUUID()
  querySetId!: string;

  @IsIn(SURFACES)
  surface!: (typeof SURFACES)[number];

  @IsOptional()
  @IsString()
  geo?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  runCount?: number;
}
