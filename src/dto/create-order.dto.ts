import { CreateOrderItemDto } from './create-order-item.dto';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Statuses } from '../enums/Statuses';
import { Type } from 'class-transformer';

export class CreateOrderDto {
  @IsOptional()
  user_id?: string;

  @IsNotEmpty()
  customer_name?: string;

  @IsNotEmpty()
  customer_email?: string;

  @IsNotEmpty()
  customer_phone?: string;

  @IsNotEmpty()
  customer_address?: string;

  @IsEnum(Statuses, { message: 'Invalid status' })
  status: Statuses;

  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  orderDetails: CreateOrderItemDto[];
}
