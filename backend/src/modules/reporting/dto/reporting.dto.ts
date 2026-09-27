import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class GenerateReportDto {
  @IsIn(['DAY1', 'MONTHLY'])
  kind!: 'DAY1' | 'MONTHLY';
}

export class ApproveReportDto {
  @IsBoolean()
  approved!: boolean;

  @IsOptional()
  @IsString()
  changesRequested?: string;
}
