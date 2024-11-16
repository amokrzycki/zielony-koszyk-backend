import { CreateOrderDetailDto } from './create-order-detail.dto';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Statuses } from '../enums/Statuses';
import { Type } from 'class-transformer';

export class CreateOrderDto {
  @IsOptional()
  userId?: string;

  @ValidateIf((o) => !o.userId)
  @IsNotEmpty()
  customer_name?: string;

  @ValidateIf((o) => !o.userId)
  @IsNotEmpty()
  customer_email?: string;

  @ValidateIf((o) => !o.userId)
  @IsNotEmpty()
  customer_phone?: string;

  @ValidateIf((o) => !o.userId)
  @IsNotEmpty()
  customer_address?: string;

  total_amount: number;

  @IsEnum(Statuses, { message: 'Invalid status' })
  status: Statuses;

  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderDetailDto)
  orderDetails: CreateOrderDetailDto[];
}
