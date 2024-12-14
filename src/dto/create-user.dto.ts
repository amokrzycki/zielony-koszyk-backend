import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;
  @IsString()
  first_name: string;
  @IsString()
  last_name: string;
  @IsString()
  street: string;
  @IsString()
  building_number: string;
  @IsString()
  zip: string;
  @IsString()
  city: string;
  @IsString()
  phone: string;
  @IsString()
  @MinLength(8)
  password: string;
}
