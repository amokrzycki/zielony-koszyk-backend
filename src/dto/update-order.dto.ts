import { IsEmail, IsEnum, ValidateNested } from 'class-validator';
import { OrderType } from '../types/OrderType';
import { Address } from '../entities/address.entity';
import { Statuses } from '../enums/Statuses';

export class UpdateOrderDto {
  @IsEnum(OrderType)
  order_type: OrderType;
  @IsEmail()
  customer_email: string;
  @ValidateNested()
  billingAddress: Address;
  @ValidateNested()
  shippingAddress: Address;
  @IsEnum(Statuses)
  status: Statuses;
}
