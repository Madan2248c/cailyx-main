import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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

/** An admin's edit to what a report says. At least one field must be sent. */
export class EditReportDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  executiveSummary?: string;
}
