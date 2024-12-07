import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;
  @IsString()
  first_name: string;
  @IsString()
  last_name: string;
  @IsString()
  address: string;
  @IsString()
  phone: string;
  @IsString()
  @MinLength(8)
  password: string;
}
