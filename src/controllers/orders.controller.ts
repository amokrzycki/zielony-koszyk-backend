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
import { OrdersService } from '../services/orders.service';
import { Order } from '../entities/order.entity';
import { CreateOrderDto } from '../dto/create-order.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findAll(): Promise<Order[]> {
    return this.ordersService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Get('order/:id')
  findOrderByOrderId(@Param('id') id: string): Promise<Order> {
    return this.ordersService.findOrderByOrderId(+id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('user-orders/:id')
  findOrdersByUserId(@Param('id') id: string): Promise<Order[]> {
    return this.ordersService.findOrdersByUserId(id);
  }

  @Post()
  create(@Body() createOrderDto: CreateOrderDto): Promise<Order> {
    return this.ordersService.create(createOrderDto);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() order: Partial<Order>,
  ): Promise<Order> {
    return this.ordersService.update(+id, order);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.ordersService.remove(+id);
  }
}
