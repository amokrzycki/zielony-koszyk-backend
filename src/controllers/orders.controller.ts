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
import { Orders } from '../entities/orders.entity';
import { CreateOrderDto } from '../dto/create-order.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiBearerAuth } from '@nestjs/swagger';

@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findAll(): Promise<Orders[]> {
    return this.ordersService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Get('order/:id')
  findOrderByOrderId(@Param('id') id: string): Promise<Orders> {
    return this.ordersService.findOrderByOrderId(+id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('user-orders/:id')
  findOrdersByUserId(@Param('id') id: string): Promise<Orders[]> {
    return this.ordersService.findOrdersByUserId(id);
  }

  @Post()
  create(@Body() createOrderDto: CreateOrderDto): Promise<Orders> {
    return this.ordersService.create(createOrderDto);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() order: Partial<Orders>,
  ): Promise<Orders> {
    return this.ordersService.update(+id, order);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.ordersService.remove(+id);
  }
}
