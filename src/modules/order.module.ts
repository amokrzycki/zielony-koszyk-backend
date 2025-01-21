import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../entities/order.entity';
import { OrderService } from '../services/order.service';
import { OrderController } from '../controllers/order.controller';
import { UserModule } from './user.module';
import { User } from '../entities/user.entity';
import { Product } from '../entities/product.entity';
import { MailService } from '../services/mail.service';
import { ConfigService } from '@nestjs/config';
import { OrderItem } from '../entities/order-item.entity';
import { InvoiceService } from '../services/invoice.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, User, Product, OrderItem]),
    UserModule,
  ],
  providers: [OrderService, ConfigService, MailService, InvoiceService],
  controllers: [OrderController],
})
export class OrderModule {}
