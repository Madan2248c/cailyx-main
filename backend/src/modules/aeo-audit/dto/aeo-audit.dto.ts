import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { SURFACES } from '../../measurement/measurement.types.js';

export class CreateAeoAuditDto {
  @IsUUID()
  querySetId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(SURFACES, { each: true })
  surfaces!: (typeof SURFACES)[number][];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  markets?: string[];
}

export class CreateCompetitorDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  domain?: string;
}

export class SetCompetitorStatusDto {
  @IsIn(['tracked', 'candidate'])
  status!: 'tracked' | 'candidate';
}
