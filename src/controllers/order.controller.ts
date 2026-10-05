import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { OrderService } from '../services/order.service';
import { Order } from '../entities/order.entity';
import { CreateOrderDto } from '../dto/create-order.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { User } from '../entities/user.entity';
import { Roles } from '../enums/Roles';
import { UpdateOrderDto } from '../dto/update-order.dto';
import { RequestLocale } from '../i18n/request-locale.decorator';
import { Locale } from '../i18n/locale';
import { invoiceFileName } from '../services/invoice.service';
import { coded, ErrorCode } from '../errors/error-code';

@ApiBearerAuth()
@Controller('orders')
export class OrderController {
  constructor(private readonly ordersService: OrderService) {}

  @UseGuards(JwtAuthGuard)
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
  @Get('order/:id/invoice')
  async downloadInvoice(
    @Param('id', ParseIntPipe) orderId: number,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const order = await this.ordersService.findOrderByOrderId(orderId);

    const currentUser = req.user as User;

    if (!order || !order.invoice_path) {
      throw coded(
        NotFoundException,
        ErrorCode.INVOICE_NOT_FOUND,
        'Invoice not found',
      );
    }

    if (
      order.user_id !== currentUser.user_id &&
      currentUser.role !== Roles.ADMIN
    ) {
      throw coded(
        ForbiddenException,
        ErrorCode.INVOICE_FORBIDDEN,
        'You are not allowed to download this invoice',
      );
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${invoiceFileName(order)}"`,
    );
    res.sendFile(order.invoice_path, { root: '.' });
  }

  @UseGuards(JwtAuthGuard)
  @Get('user-orders/:id')
  findOrdersByUserId(@Param('id') id: string): Promise<Order[]> {
    return this.ordersService.findOrdersByUserId(id);
  }

  @Post()
  create(
    @Body() createOrderDto: CreateOrderDto,
    @RequestLocale() locale: Locale,
  ): Promise<Order> {
    return this.ordersService.create(createOrderDto, locale);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() order: UpdateOrderDto,
  ): Promise<Order> {
    return this.ordersService.update(+id, order);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.ordersService.remove(+id);
  }
}
