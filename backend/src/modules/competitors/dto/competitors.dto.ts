import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateCompetitorDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  domain?: string;
}

export class UpdateCompetitorDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  domain?: string | null;

  @IsOptional()
  @IsIn(['tracked', 'candidate'])
  status?: 'tracked' | 'candidate';
}
