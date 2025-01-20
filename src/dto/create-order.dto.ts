import { CreateOrderItemDto } from './create-order-item.dto';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OrderType } from '../types/OrderType';

export class CreateOrderDto {
  @IsOptional()
  user_id?: string;

  @IsEnum(OrderType, { message: 'Invalid order type' })
  order_type: OrderType;

  @ValidateIf((o) => o.order_type === OrderType.COMPANY)
  @IsString()
  company_name?: string;

  @ValidateIf((o) => o.order_type === OrderType.COMPANY)
  @IsString()
  nip?: string;

  @IsNotEmpty()
  customer_name?: string;

  @IsNotEmpty()
  customer_email?: string;

  @IsNotEmpty()
  customer_phone?: string;

  @IsNotEmpty()
  customer_address?: string;

  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  orderDetails: CreateOrderItemDto[];
}
