import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateQuerySetDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;
}

export class GenerateQuerySetDto {
  @IsOptional()
  @IsString()
  tier?: string;
}

export class AddPromptDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  prompt!: string;

  @IsOptional()
  @IsIn(['problem_aware', 'solution_aware', 'product_aware', 'most_aware'])
  funnelStage?: string;

  @IsOptional()
  @IsIn(['branded', 'unbranded'])
  branding?: string;
}
