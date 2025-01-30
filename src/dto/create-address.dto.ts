import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';
import { AddressType } from '../enums/AddressType';
import { CustomerType } from '../types/CustomerType';
import { Address } from '../entities/address.entity';

export class CreateAddressDto {
  @ValidateIf((o: Address) => o.customer_type === CustomerType.PERSON)
  @IsString()
  first_name: string;

  @ValidateIf((o: Address) => o.customer_type === CustomerType.PERSON)
  @IsString()
  last_name: string;

  @ValidateIf((o: Address) => o.customer_type === CustomerType.COMPANY)
  @IsString()
  company_name: string;

  @ValidateIf((o: Address) => o.customer_type === CustomerType.COMPANY)
  @IsString()
  @Length(10, 11)
  nip: string;

  @IsString()
  phone: string;

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

  @IsOptional()
  default: boolean;

  @IsEnum(CustomerType)
  customer_type: CustomerType;
}
