import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderItemsService } from '../services/order-items.service';
import { OrderItemsController } from '../controllers/order-items.controller';
import { OrdersModule } from './orders.module';
import { ProductsModule } from './products.module';
import { OrderItems } from '../entities/order-items.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderItems]),
    OrdersModule,
    ProductsModule,
  ],
  providers: [OrderItemsService],
  controllers: [OrderItemsController],
})
export class OrderItemsModule {}
