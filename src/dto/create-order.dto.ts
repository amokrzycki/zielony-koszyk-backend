import { CreateOrderItemDto } from './create-order-item.dto';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OrderType } from '../types/OrderType';
import { CreateAddressDto } from './create-address.dto';

export class CreateOrderDto {
  @IsOptional()
  user_id?: string;

  @IsEnum(OrderType, { message: 'Invalid order type' })
  order_type: OrderType;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateAddressDto)
  billingAddress?: CreateAddressDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateAddressDto)
  shippingAddress?: CreateAddressDto;

  @IsOptional()
  same_address: boolean;

  @IsNotEmpty()
  customer_email: string;

  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  orderItems: CreateOrderItemDto[];
}
