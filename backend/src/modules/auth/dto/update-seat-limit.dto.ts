import { IsInt, Min } from 'class-validator';

export class UpdateSeatLimitDto {
  @IsInt()
  @Min(1)
  seatLimit!: number;
}
