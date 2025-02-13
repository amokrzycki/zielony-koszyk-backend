import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { Roles } from '../enums/Roles';

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
  @IsOptional()
  @IsString()
  flat_number: string;
  @IsString()
  zip: string;
  @IsString()
  city: string;
  @IsString()
  phone: string;
  @IsEnum(Roles)
  role: Roles;
}
