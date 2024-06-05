import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { OrderDetailsService } from '../services/order-details.service';
import { OrderDetail } from '../entities/order-detail.entity';

@Controller('order-details')
export class OrderDetailsController {
  constructor(private readonly orderDetailsService: OrderDetailsService) {}

  @Get()
  findAll(): Promise<OrderDetail[]> {
    return this.orderDetailsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<OrderDetail> {
    return this.orderDetailsService.findOne(+id);
  }

  @Post()
  create(@Body() orderDetail: Partial<OrderDetail>): Promise<OrderDetail> {
    return this.orderDetailsService.create(orderDetail);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() orderDetail: Partial<OrderDetail>,
  ): Promise<OrderDetail> {
    return this.orderDetailsService.update(+id, orderDetail);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.orderDetailsService.remove(+id);
  }
}
