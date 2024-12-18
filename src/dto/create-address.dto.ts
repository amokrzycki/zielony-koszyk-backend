import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AddressType } from '../enums/AddressType';

export class CreateAddressDto {
  @IsString()
  street: string;

  @IsString()
  city: string;

  @IsString()
  zip: string;

  @IsString()
  building_number: string;

  @IsOptional()
  @IsString()
  flat_number: string;

  @IsEnum(AddressType)
  type: AddressType;
}
