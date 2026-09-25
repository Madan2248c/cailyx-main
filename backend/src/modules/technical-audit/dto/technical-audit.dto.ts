import { IsIn } from 'class-validator';

export class SetTechnicalAuditScheduleDto {
  /** WEEKLY, MONTHLY, or MANUAL_ONLY (removes the recurrence). */
  @IsIn(['WEEKLY', 'MONTHLY', 'MANUAL_ONLY'])
  cadence!: 'WEEKLY' | 'MONTHLY' | 'MANUAL_ONLY';
}
