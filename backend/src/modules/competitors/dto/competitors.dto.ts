import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateCompetitorDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  domain?: string;
}
