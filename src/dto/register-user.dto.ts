import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterUserDto {
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
  @IsOptional()
  @IsString()
  flat_number: string;
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
