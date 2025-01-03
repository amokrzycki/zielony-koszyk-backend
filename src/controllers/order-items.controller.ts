import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { OrderItemsService } from '../services/order-items.service';
import { OrderItems } from '../entities/order-items.entity';

@Controller('order-details')
export class OrderItemsController {
  constructor(private readonly orderItemsService: OrderItemsService) {}

  @Get()
  findAll(): Promise<OrderItems[]> {
    return this.orderItemsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: number): Promise<OrderItems[]> {
    return this.orderItemsService.findByOrderId(id);
  }

  @Post()
  create(@Body() orderItem: Partial<OrderItems>): Promise<OrderItems> {
    return this.orderItemsService.create(orderItem);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() orderItem: Partial<OrderItems>,
  ): Promise<OrderItems> {
    return this.orderItemsService.update(+id, orderItem);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.orderItemsService.remove(+id);
  }
}
