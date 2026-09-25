import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateClientDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  pocEmail!: string;
}
