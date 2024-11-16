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

@Module({
  imports: [TypeOrmModule.forFeature([Order, User, Product]), UsersModule],
  providers: [OrdersService, ConfigService, MailService],
  controllers: [OrdersController],
})
export class OrdersModule {}
