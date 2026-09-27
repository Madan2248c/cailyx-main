import { IsIn } from 'class-validator';

export class SetRecommendationStatusDto {
  @IsIn(['OPEN', 'DONE', 'DISMISSED'])
  status!: 'OPEN' | 'DONE' | 'DISMISSED';
}
