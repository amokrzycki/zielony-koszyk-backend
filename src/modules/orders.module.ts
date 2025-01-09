import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Orders } from '../entities/orders.entity';
import { OrdersService } from '../services/orders.service';
import { OrdersController } from '../controllers/orders.controller';
import { UsersModule } from './users.module';
import { Users } from '../entities/users.entity';
import { Products } from '../entities/products.entity';
import { MailService } from '../services/mail.service';
import { ConfigService } from '@nestjs/config';
import { OrderItems } from '../entities/order-items.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Orders, Users, Products, OrderItems]),
    UsersModule,
  ],
  providers: [OrdersService, ConfigService, MailService],
  controllers: [OrdersController],
})
export class OrdersModule {}
