import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../entities/order.entity';
import { OrdersService } from '../services/orders.service';
import { OrdersController } from '../controllers/orders.controller';
import { UsersModule } from './users.module';
import { User } from '../entities/user.entity';
import { Product } from '../entities/product.entity';
import { MailService } from '../services/mail.service';
import { ConfigService } from '@nestjs/config';
import { OrderItem } from '../entities/order-item.entity';
import { InvoiceService } from '../services/invoice.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, User, Product, OrderItem]),
    UsersModule,
  ],
  providers: [OrdersService, ConfigService, MailService, InvoiceService],
  controllers: [OrdersController],
})
export class OrdersModule {}
