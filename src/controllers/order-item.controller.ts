import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { OrderItemService } from '../services/order-item.service';
import { OrderItem } from '../entities/order-item.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiBearerAuth } from '@nestjs/swagger';
import { CreateOrderItemDto } from '../dto/create-order-item.dto';

@ApiBearerAuth()
@Controller('order-items')
export class OrderItemController {
  constructor(private readonly orderItemsService: OrderItemService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(): Promise<OrderItem[]> {
    return this.orderItemsService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: number): Promise<OrderItem[]> {
    return this.orderItemsService.findByOrderId(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() orderItem: CreateOrderItemDto[]): Promise<OrderItem[]> {
    return this.orderItemsService.create(orderItem);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  update(
    @Param('id') id: number,
    @Body() orderItem: Partial<OrderItem>,
  ): Promise<OrderItem> {
    return this.orderItemsService.update(id, orderItem);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: number): Promise<void> {
    return this.orderItemsService.remove(id);
  }
}
