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
import { OrderItemsService } from '../services/order-items.service';
import { OrderItems } from '../entities/order-items.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiBearerAuth } from '@nestjs/swagger';
import { CreateOrderItemDto } from '../dto/create-order-item.dto';

@ApiBearerAuth()
@Controller('order-items')
export class OrderItemsController {
  constructor(private readonly orderItemsService: OrderItemsService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(): Promise<OrderItems[]> {
    return this.orderItemsService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: number): Promise<OrderItems[]> {
    return this.orderItemsService.findByOrderId(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() orderItem: CreateOrderItemDto[]): Promise<OrderItems[]> {
    return this.orderItemsService.create(orderItem);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  update(
    @Param('id') id: number,
    @Body() orderItem: Partial<OrderItems>,
  ): Promise<OrderItems> {
    return this.orderItemsService.update(id, orderItem);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: number): Promise<void> {
    return this.orderItemsService.remove(id);
  }
}
